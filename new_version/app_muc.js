
var crypto = require ('crypto');
var fs = require ('fs');
var xmpp = require('node-xmpp');

var configModule = require('./config');

var config = configModule['app_muc'];

var db = require ('./dbconnect2.js')(config);

console.log("\n---------------------------------------------\n\
app_muc.js 1.0\n\
Copyright (c) 2014 Max Weller\n\
This program comes with ABSOLUTELY NO WARRANTY; This is free software, and\n\
you are welcome to redistribute it under certain conditions; see LICENSE\n\
file in this folder for details.\n\
---------------------------------------------\n\
");
console.log(new Date());

var component = new xmpp.Component({
  jid: config.xmppComponentJid,
  password: config.xmppComponentSecret,
  host: config.xmppHost,
  port: Number(config.xmppPort),
  reconnect: true
});

var runtimeId = Math.floor(Math.random()*100000)+1;

var lastUpload = "";

var uploadIdCounter = 1;
var clientIdCounter = 1;

var connectedUsers = {};
var connectedClients = {};

var rooms = {};


//--> Initialization
db.mongo.rooms.find().toArray(function(err, results) {
    if(err) { console.log(" ! couldnt read rooms from database"); return; }
    
    for(var i in results) {
      var name = results[i].name;
      rooms[name] = results[i];
      var decoded = {};
      if (rooms[name].members)
        for(var key in rooms[name].members) decoded[unescape(key)] = rooms[name].members[key];
      rooms[name].members = decoded;
    }
});

db.mongo.userinfo.find().toArray(function(err, results) {
    if(err) { console.log(" ! couldnt read userInfo from database"); return; }
    
    for(var i in results) {
      var name = results[i].user;
      connectedUsers[name] = results[i];
    }
});



var XMLNS_MUC = "http://jabber.org/protocol/muc";
var JABBER_ID_REGEX = /^([a-zA-Z0-9_.#%-]+)@([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_. %-]+)$/;
var JABBER_ID_REGEX_LIBERAL = /^([a-zA-Z0-9_.#%-]+)@([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.#% ŠšŸ€…†§-]+)$/;
var JABBER_ID_REGEX2 = /^([a-zA-Z0-9_.#%-]+)@([a-zA-Z0-9_.-]+)/;
var myJid = config.xmppComponentJid;

// jabber component

component.on('online', function() {
  console.log('Component is online as '+myJid)
  component.on('stanza', onXmppStanza);
  // nodejs has nothing left to do and will exit
  //component.end()
});

component.on('error', function(e) {
  console.error(" ! XMPP error: " + e);
});



function getRoomHistory(roomName, beforeTs, amount, afterTs, callback) {
  var query = {};
  if (beforeTs) query.ts = { $lt: beforeTs };
  if (afterTs) query.ts = { $gt: afterTs };
  if (beforeTs && afterTs) query.ts = { $lt: beforeTs, $gt: afterTs };
  query.room = roomName;

  var cursor = db.mongo.messages.find(query).sort({_id: -1}).limit(amount).toArray(callback)
}

function postMsg(room, from, text, xmppid, jid) {
  var ts = +new Date();
  
  if (!xmppid) xmppid = randId();
  
  // broadcast to XMPP and Socket.io
  broadcastRoom(room, 'msg', { by: from, msg: text, ts: ts, xmppid: xmppid });
  
  // store message in history database
  db.mongo.messages.save({
    by: from, room: room, msg: text, ts: ts, xmppid: xmppid, jid: jid
  }, function(err, msg) {
    console.log("   postMsg",err,msg);
  });
}


function dotescape(s) {
  if (s) return s.replace(/\./g, "%2E"); else return "";
}
// New Room Management

function makeSureRoomExists(roomName) {
  if (! rooms[roomName]) {
    rooms[roomName] = { name: roomName, subject: "Untitled room", members: {} };
    db.mongo.rooms.update({ name: roomName }, rooms[roomName], {upsert:true});
  }
}

function joinRoom(roomName, userId, data) {
  makeSureRoomExists(roomName);
  data.id = userId;
  rooms[roomName].members[userId] = data;
  
  var set = { $set: {} }; set.$set["members."+dotescape(userId)] = data;
  db.mongo.rooms.update({ name: roomName }, set);
}
function leaveRoom(roomName, userId, optional_Status) {
  if (! rooms[roomName] || ! rooms[roomName].members[userId]) return;
  var userData = rooms[roomName].members[userId];
  delete rooms[roomName].members[userId];
  
  var set = { $unset: {} }; set.$unset["members."+dotescape(userId)] = "";
  db.mongo.rooms.update({ name: roomName }, set);
  
  if (userData.nick)
    broadcastRoom(roomName, 'presence', getPresenceMessage(userData, false, optional_Status));
}
function broadcastRoom(roomName, msgType, data) {
  console.log("broadcast",roomName,msgType);
  if (! rooms[roomName]) return;
  data.roomName = roomName;
  for (var i in rooms[roomName].members) {
    console.log("...",i);
    //if (rooms[roomName].members[i].msg) {
    //it's always XMPP...
        // send to XMPP via xmppMessageHandler
      xmppMessageHandler.call(rooms[roomName].members[i], msgType, data);
    //}
  }
}
function getRoomMembers(roomName) {
  makeSureRoomExists(roomName);
  return rooms[roomName].members;
}
function getRoomMember(roomName, name) {
  makeSureRoomExists(roomName);
  var mem= rooms[roomName].members;
  if (mem) return mem[name];
}


function getUserInfo(userJid, item) {
  var username = userJid.replace(/\/.*$/, "");
  if(!connectedUsers[username]) connectedUsers[username] = {};
  if (item) return connectedUsers[username][item];
  return connectedUsers[username];
}
function storeUserInfo(userJid) {
  var username = userJid.replace(/\/.*$/, "");
  var info = getUserInfo(userJid);
  info.changed = ''+new Date();
  info.user = username;
  db.mongo.userinfo.update({user:username}, info, {upsert:true});
}


function getPresenceMessage(userData, wentOnline, optional_Status) {
  var presence = { nick: userData.nick, transport: userData.type, id: userData.id, status: optional_Status };
  if (!wentOnline) presence.type = 'unavailable';
  return presence;
}




//==> Handle Incoming Stanzas

function onXmppStanza(stanza) {
  console.log('--- Received stanza: ', stanza.toString());
  
  if (stanza.getChild('error')) console.log(" ! ERROR STANZA");
  
  //--> iq stanza (service discovery)
  if (stanza.is('iq') && stanza.attrs.type == 'get') {
    var recp = stanza.attrs.to.split(/@/);
    
    //-->  - chat service announcement, list all chatrooms
    if (recp.length == 1 && recp[0] == myJid) {
      if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#info")) {
        var disco = discoReply(stanza, query), d = disco.getChild('query');
        d.c('identity', { category: 'conference', type: 'text', name: 'TeamWiki Chat System' });
        d.c('feature', { 'var': 'http://jabber.org/protocol/muc' });
        xmppSend("sent info stanza : ", disco);
      }
      if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#items")) {
        var disco = discoReply(stanza, query), d = disco.getChild('query');
        for (var i in rooms) {
          if (rooms[i].properties && rooms[i].properties.hidden == "true") continue;
          d.c('item', { jid: i + '@' + myJid, name: rooms[i].subject||i });
        }
        xmppSend("sent items stanza : ", disco);
      }
    }
    
    //--> - chatroom details, member list
    if (recp.length == 2 && recp[1] == myJid) {
      var room = rooms[recp[0]];
      if (room && ! (room.properties && room.properties.hidden == "true") ) {
        if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#info")) {
          var disco = discoReply(stanza, query), d = disco.getChild('query');
          disco.attrs.from = stanza.attrs.to;
          d.c('identity', { category: 'conference', type: 'text', name: room.subject||recp[0] });
          d.c('feature', { 'var': XMLNS_MUC });
          d.c('feature', { 'var': 'muc_open' });
          d.c('feature', { 'var': 'muc_permanent' });
          d.c('feature', { 'var': 'muc_public' });
          if(room.properties && room.properties['password-required'])
            d.c('feature', { 'var': 'muc_passwordprotected' });
          
          xmppSend("sent info stanza : ", disco);
        }
        if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#items")) {
          var disco = discoReply(stanza, query), d = disco.getChild('query');
          disco.attrs.from = stanza.attrs.to;
          for(var i in room.members)
            d.c('item', { jid: stanza.attrs.to + '/' + room.members[i].nick });
          xmppSend("sent items stanza : ", disco);
        }
      } else {
        var disco = discoReply(stanza, query), d = disco.getChild('query');
        xmppSend("sent empty result stanza : ", disco);
      }
    }
    
    //--> - details about chatroom occupants
    if (recp = stanza.attrs.to.match(JABBER_ID_REGEX)) {
      if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#info")) {
        var disco = discoReply(stanza, query), d = disco.getChild('query');
        disco.attrs.from = stanza.attrs.to;
        d.c('identity', { category: 'client', type: 'pc' });
        d.c('feature', { 'var': XMLNS_MUC });
        // TODO XEP-0045 6.7 - contact the client for real data
        xmppSend("sent info stanza from "+disco.attrs.from+" : ", disco);
      }
      if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#items")) {
        var disco = discoReply(stanza, query), d = disco.getChild('query');
        disco.attrs.from = stanza.attrs.to;
        xmppSend("sent items stanza : ", disco);
      }
      if (query = stanza.getChild('vCard', "vcard-temp")) {
        var iq = new xmpp.Element('iq', 
                                  { type: 'error', from: myJid, to: stanza.attrs.from, id: stanza.attrs.id });
        xmppSend("sent error stanza : ", iq);
      }
      
    }
  }
  
  //--> presence stanza
  if (stanza.is('presence')) {
    var r;
    if (( r = stanza.attrs.to.match(JABBER_ID_REGEX)  )) {
      if (stanza.attrs.type == "unavailable") {
        leaveRoom(r[1], stanza.attrs.from);
        xmppSendPresence(stanza.attrs.to, stanza.attrs.from, 'member', 'none', 'unavailable', [ '110' ]);
        
        return;
      }
      var xMucChild = stanza.getChild("x", "http://jabber.org/protocol/muc"), historyChild = null, passwdProvided = null;
      if (xMucChild) {
        historyChild = xMucChild.getChild("history");
        passwdProvided = xMucChild.getChildText("password");
      }
      xmppJoinRoom(r[1], r[2], r[3], stanza.attrs.from, historyChild, passwdProvided);
    
    /*
       clients do not support it... (at least jitsi)
    } else if (( r = stanza.attrs.to.match(JABBER_ID_REGEX_LIBERAL)  ) && stanza.attrs.type != "unavailable") {
      r[3] = r[3].toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
      var xMucChild = stanza.getChild("x", "http://jabber.org/protocol/muc"), historyChild = null;
      if (xMucChild) {
        historyChild = xMucChild.getChild("history");
      }
      xmppJoinRoom(r[1], r[2], r[3], stanza.attrs.from, historyChild);
      */
    
    } else {
      var p = new xmpp.Element('presence', { from: stanza.attrs.to, to: stanza.attrs.from, id: stanza.attrs.id, type: 'error' });
      p.c('x', { 'xmlns': XMLNS_MUC });
      p.c('error', { by: myJid, type: 'modify' })
        .c('jid-malformed', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' });
      xmppSend("presence error", p);
      
      xmppErrMes(stanza.attrs.from, "Unable to join room "+stanza.attrs.to+" because the jabber id was invalid (try to provide another nickname).");
      
    }
  }
  
  //--> message stanza
  if (stanza.is('message')) {
    var r;
    console.log("   INCOMING MESSAGE ");
    if (( r = stanza.attrs.to.match(JABBER_ID_REGEX2) )) {
      var users = getRoomMembers(r[1]), user = users[stanza.attrs.from];
      console.log("   TO(regexResult):",""+r, "FROM:",stanza.attrs.from);
      if (user) {
        
        // if it is a valid room member, decide on the child tags
        
        if (( error = stanza.getChild('error') )) {
            // throw out ghost users
            var errStr = "Left because of error : ";
            try { errStr += error.children[0].name; }
            catch(exc) { errStr += (""+error); }
            
            leaveRoom(r[1], stanza.attrs.from, errStr);
            xmppSendPresence(stanza.attrs.to, stanza.attrs.from, 'member', 'none', 'unavailable', [ '110' ], null, null, errStr);
            
            
        } else if (( body = stanza.getChild('body') )) {
            // pass along regular messages
            
            var messageText = stanza.getChildText('body');
            if (messageText && (messageText.charAt(0)=="#" || messageText.charAt(0)=="." || messageText.charAt(0)=="/")) {
              runBotCommand(r, stanza.attrs.from, messageText, stanza.attrs.id);
            } else if (isMessageOverlyLong(rooms[r[1]], messageText)) {
              storePastebin(messageText, function(newMsg) {
                postMsg(r[1], user.nick, newMsg, stanza.attrs.id, stanza.attrs.from);
              });
            } else {
              postMsg(r[1], user.nick, messageText, stanza.attrs.id, stanza.attrs.from);
            }
            
        } else if (( subject = stanza.getChild('subject') )) {
            // room subject changes
            setRoomTopic(r[1], user.nick, stanza.getChildText('subject'));
            
        }
        //var data = { nick: user.nick, msg: stanza.getChildText('body') };
        //broadcastRoom(r[1], 'message', data);
      }
    }
  }
}

function runBotCommand(stanza_roomArray, stanza_fromJid, messageText) {
  fs.readFile("bot.js", function(err,result) {
    console.log("bot: ",err);
    try {
      eval(result.toString())(stanza_roomArray, stanza_fromJid, messageText);
    } catch(err) {
      console.log(" ! BOT ERR:", err);
    }
  })
}

function setRoomTopic(room, fromNick, topic) {
  broadcastRoom(room, 'subject', {subject: topic, nick: fromNick });
  
  db.mongo.rooms.update({ name: room }, { $set: {"subject": topic} });
  rooms[room].subject = topic;
  
}

function setRoomProp(room, propName, propValue) {
  var set = { $set: {  } }; set.$set["properties."+propName] = propValue;
  db.mongo.rooms.update({ name: room }, set);
  if(!rooms[room].properties)rooms[room].properties = {};
  rooms[room].properties[propName] = propValue;
}
function getRoomProp(room, propName, defaultVal, minimumIntVal) {
  if(!rooms[room].properties)rooms[room].properties = {};
  var val = rooms[room].properties[propName];
  
  if (!val) return defaultVal; else {
    if(minimumIntVal) val=Math.max(minimumIntVal, parseInt(val, 10));
    
    return val;
  }
}

function xmppJoinRoom(stanza_room, stanza_roomHost, stanza_roomNick, stanza_joinerJid, historyChild, passwdProvided) {
  
  var mems = getRoomMembers(stanza_room);
  var rprefix = stanza_room+'@'+stanza_roomHost+'/';
  
  var alreadyIn = (stanza_joinerJid in mems);
  var passwdReq = getRoomProp(stanza_room, "password-required", "");
  
  console.log("+++ JOIN: ",stanza_room,stanza_roomNick,"alreadyIn:"+alreadyIn,"passw/"+passwdProvided+"/"+passwdReq);
  
  if (!alreadyIn && passwdReq && passwdProvided!=passwdReq) {
    var p = new xmpp.Element('presence', { from: rprefix+stanza_roomNick, to: stanza_joinerJid,  type: 'error' });
    p.c('x', { 'xmlns': XMLNS_MUC });
    p.c('error', { by: myJid, type: 'modify' })
      .c('not-authorized', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' });
    xmppSend("presence error - passwd required", p);
    
    xmppErrMes(stanza_joinerJid, "Unable to join room "+rprefix+" - access denied (password).");
    return;
  }
  
  
  for (var i in mems) {
    xmppSendPresence(rprefix+mems[i].nick, stanza_joinerJid, mems[i].xmppaffil||'member', mems[i].xmpprole||'participant', null, null, mems[i].id, mems[i].xmppshow);
  }
  broadcastRoom(stanza_room, 'presence', getPresenceMessage({ nick: stanza_roomNick, type: 'jabber', id: stanza_joinerJid }, true));
  
  xmppSendPresence(rprefix+'roombot', stanza_joinerJid, 'member', 'participant');
  var p = new xmpp.Element('presence', { from: rprefix+stanza_roomNick, to: stanza_joinerJid, id: stanza_joinerJid });
  p.c('status').body(getUserInfo(stanza_joinerJid, "statusMessage"));
  p.c('x', { xmlns: XMLNS_MUC + '#user' })
    .c('item', { affiliation: 'member', role: 'participant', jid: stanza_joinerJid }).up()
    .c('status', { code: '110' }).up() // references the user itself
    .c('status', { code: '100' }).up() // non-anonymous
    .c('status', { code: '170' }).up() // room is logged
    .c('status', { code: '210' });     // joined the room
  //if (stanza.getChild('c')) p.cnode(stanza.getChild('c'));
  //if (stanza.getChild('priority')) p.cnode(stanza.getChild('priority'));

  xmppSend("self presence stanza:",p);
  
  
  joinRoom(stanza_room, stanza_joinerJid, { type: 'jabber', nick: stanza_roomNick, msg: xmppMessageHandler });
  
  // avoid history-resend on away change (adium...)
  if (!alreadyIn || historyChild) {
    xmppSendHistory(stanza_room, stanza_joinerJid, historyChild);
    
    var subj_msg = xmppSubjectMessage(stanza_room, 'roombot', stanza_joinerJid, rooms[stanza_room].subject);
    xmppSend("subject message:", subj_msg);
    
  }
  
}


function xmppMessageHandler(msgType, data) {
  switch(msgType) {
  case "presence":
    var stat = (this.id == data.id) ? [110] : null;
    var member = getRoomMember(data.roomName, data.id);
    var xmppshow = member && member.xmppshow,
        xmppaffil = member && member.xmppaffil,
        xmpprole = member && member.xmpprole;
    console.log("   messageHandler(presence)", member, xmppshow);
    xmppSendPresence(data.roomName+'@'+myJid+'/'+data.nick, this.id, xmppaffil||'member', xmpprole||'participant',
                     data.type, stat, data.id, xmppshow, data.status);
    break;
  case "msg":
    var msg = xmppMessage(data.roomName, data.by, this.id, data.msg, data.xmppid);
    xmppSend("sending message", msg);
    break;
  case "subject":
    var msg = xmppSubjectMessage(data.roomName, data.nick, this.id, data.subject);
    xmppSend("sending new subject", msg);
    break;
  }
}

function xmppSendPresence(from, to, affil, role, type, status, fromJid, xmppShow, xmppStatus) {
  var p = new xmpp.Element('presence', { from: from, to: to, id: randId() });
  if (type) p.attrs.type = type;
  var x = p.c('x', { xmlns: XMLNS_MUC + '#user' });
  x.c('item', { affiliation: affil, role: role, jid: fromJid });
  if(status) {
    for(var i=0; i<status.length; i++) x.c('status', { code: status[i] });
  }
  if (xmppShow) p.c('show').t(xmppShow);
  if (xmppStatus) p.c('status').t(xmppStatus);
  else if (fromJid) p.c('status').body(getUserInfo(fromJid, "statusMessage"));
  xmppSend("xmppSendPresence", p);
}

function xmppSendHistory(room, to, historyInfo) {
  var numstanzas = 10, histsince;
  if (historyInfo) {
    if (historyInfo.attrs.maxchars && historyInfo.attrs.maxchars == '0') {
        numstanzas = 0;
    } else if (historyInfo.attrs.maxstanzas) {
        numstanzas = + historyInfo.attrs.maxstanzas;
    } else if (historyInfo.attrs.since) {
        try {
          histsince = new Date(historyInfo.attrs.since).getTime();
          numstanzas = 200;
        }catch(e){ console.log("Unable to parse history.since date:",historyInfo.attrs); }
    }
  }
  console.log("Sending History: ", numstanzas, histsince, historyInfo);
  getRoomHistory(room, null, numstanzas, histsince, function(err, results) {
    if (err) {
      console.log("error loading history", err);
      
    } else {
      for (var i = results.length - 1; i >= 0; i--) {
        var r = results[i];
        var msg = xmppMessage(room, r.by, to, r.msg, r.xmppid);
        try {
          msg.c('delay', { xmlns: 'urn:xmpp:delay', from: room+'@'+myJid, stamp: new Date(r.ts).toISOString() });
          msg.c('x', { xmlns: 'urn:xmpp:delay', from: room+'@'+myJid, stamp: new Date(r.ts).toISOString() });
        } catch(e) {} //sometimes timestamp seems to be invalid
        xmppSend("Sending History", msg);
      }
    }
  })
}

function xmppMessage(room, nick, to, body, msgid) {
  if(!msgid) msgid=randId();
  var msg = new xmpp.Element('message', { type: 'groupchat', from: room+'@'+myJid+'/'+nick, to: to, id: msgid });
  msg.c('body').t(body);
  return msg;
}

function xmppSubjectMessage(room, bynick, to, subject, msgid) {
  if(!msgid) msgid=randId();
  var msg = new xmpp.Element('message', { type: 'groupchat', from: room+'@'+myJid+'/'+bynick, to: to, id: msgid });
  msg.c('subject').t(subject);
  return msg;
}

function xmppErrMes(to, body) {
  var msg = new xmpp.Element('message', { from: myJid, to: to });
  msg.c('body').t(body);
  xmppSend("ERR MES SEND:", msg);
}

function xmppSend(debug, msg) {
  console.log(" > "+debug, "\t", msg.toString());
  component.send(msg);
}

function randId() {
  return Math.floor(Math.random()*10000000)+1000000;
}


function discoReply(stanza, query) {
  var disco = new xmpp.Element('iq', 
                               { type: 'result', from: myJid, to: stanza.attrs.from, id: stanza.attrs.id });
  disco.c('query', { xmlns: query && query.attrs.xmlns });
  return disco;
}


function isMessageOverlyLong(roomInfo, messageText) {
  if (messageText.length >= getRoomProp(roomInfo.name, "paste-min-length", 750, 140))
    return true;
  var lines=messageText.split("\n");
  if (lines.length >= getRoomProp(roomInfo.name, "paste-min-lines", 7, 2)) return true;
  return false;
}

//HACK HACK HACK
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

function storePastebin(messageText, callback) {
  var request = require('request');

  request.post(
      { uri: 'https://paste.teamwiki.de/api/',
      rejectUnauthorized: false, form: { content: messageText, lexer: 'plain', format: 'url', expires: 'never' } },
      function (error, response, body) {
          if (!error && response.statusCode == 200) {
            messageText=messageText.substr(0,messageText.indexOf("\n")==-1?300:messageText.indexOf("\n"));
              callback(messageText+"\n"+"[*** snip  "+body.toString().trim()+"  ***]");
          } else {
            console.log(" ! Unable to shorten message: ",error,response&&response.statusCode,body);
            callback(messageText);
          }
      }
  );
}


