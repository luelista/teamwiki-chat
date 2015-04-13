#!/usr/bin/env node
console.log("\n---------------------------------------------\n\
app_muc.js 1.0\n\
Copyright (c) 2014 Max Weller\n\
This program comes with ABSOLUTELY NO WARRANTY; This is free software, and\n\
you are welcome to redistribute it under certain conditions; see LICENSE\n\
file in this folder for details.\n\
---------------------------------------------\n\
");

var crypto = require ('crypto');
var fs = require ('fs');
var xmpp = require('node-xmpp');
var http = require('http');
var JID = xmpp.JID;

var configModule = require('./config');

var configSection = process.env.APP_CONFIG || 'app_muc'
var config = configModule[configSection];

console.log("Using configuration section:    " + configSection);

var db = require ('./dbconnect2.js')(config);

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

function is_yes(str) {
    if (str) return true;
    if (typeof str != "string") return false;
    str=str.toLowerCase();
    if(str=="yes"||str=="true"||str=="on")return true; else return false;
}

if (config.httpPort) {
    var httpSrv = http.createServer(function(req, resp) {
	console.log("http request: "+req.method+"\t"+req.url);
	function err_400(answer, num) {
	    console.log("HTTP ERROR", answer, num);
	    if (!answer) answer = "The server is unable to fulfill this request.\n";
	    resp.writeHead(num || 400, { "Content-Length": answer.length });
	    resp.end(answer);
	}
	function err_401(answer) {
	    if (!answer) answer = "Unauthorized.\n";
	    resp.writeHead(401, { "WWW-Authenticate": "Basic realm=\""+m[1]+"\"", "Content-Length": answer.length });
	    resp.end(answer);
	}
	var m = req.url.match(/^\/([a-z0-9_.-]+)(\/.*)?$/);
	if (!m) {
	    err_400("Invalid URL format."); return;
	}
	if (req.method == "GET") {
	    var pw = getRoomProp(m[1], "web-archive-password");
	    if (!pw) { err_400("Channel not found or disabled.\n", 404); return; }
	    var auth = req.headers["authorization"] ? new Buffer(req.headers["authorization"].substr(6), 'base64').toString().split(/:/) : ['',''];
	    
	    if (pw != auth[1]) { err_401(); return; }
	    var mm;
	    console.log(m);
	    if (m[2] && (mm = m[2].match(/\/ts=([0-9]+)/))) {
		var ts = parseInt(mm[1]), out = '[\n', first = true;
		//ts = 0;
		console.log("calling getRoomHistory");
		getRoomHistory(m[1], ts, 100, null, function(err, msg) {
		    console.log("getRoomHistory callback:",err,msg);
		    if (err) err_400("Internal error\n", 500);
		    else if (msg) {
			out += '  ' + (first ? '' : ',') + JSON.stringify([msg.ts, msg.xmppid, msg.by, msg.msg]) + "\n";
			first = false;
		    } else {
			out += ']';
			out = new Buffer(out, "utf8");
			resp.writeHead(200, { "Content-Length": out.length, "Content-Type": "application/json; charset=utf-8" });
			resp.end(out);
		    }
		});
	    } else {
		var out = ' <script src="//public_html.luelistan.net/js/jquery-2.1.3.min.js"></script><script src="//public_html.luelistan.net/js/chatlog.js"></script> ';
		resp.writeHead(200, { "Content-Length": out.length, "Content-Type": "text/html; charset=utf-8" });
		resp.end(out);
		
	    }
	    
	} else if (req.method == "POST") {
	    if (!is_yes(getRoomProp(m[1], "allow-http-post", 0))) {
		var answer = "This channel either does not exist or you are not allowed to POST messages into it.\n";
		resp.writeHead(404, { "Content-Length": answer.length });
		resp.end(answer);
		return;
	    }
	    var data = "";
	    req.on("data", function(dataIn) {
		data += dataIn;
	    });
	    req.on("end", function() {
		if (req.headers["x-forwarded-for"]) data = "External message from "+req.headers["x-forwarded-for"]+":\n"+data;
		postMsg(m[1], "roombot", data, null);
		var answer = "Posted\n";
		resp.writeHead(200, { "Content-Length": answer.length });
		resp.end(answer);
	    });
	} else {
	    err_400("Method not implemented.\n");
	}
    }).listen(config.httpPort, "127.0.0.1");
}

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
  // nodejs has nothing left to do and will exit
  //component.end()
});
component.on('stanza', onXmppStanza);

component.on('error', function(e) {
  console.error(" ! XMPP error: " + e);
});



function getRoomHistory(roomName, beforeTs, amount, afterTs, callbackIter) {
  var query = {};
  if (beforeTs) query.ts = { $lt: beforeTs };
  if (afterTs) query.ts = { $gt: afterTs };
  if (beforeTs && afterTs) query.ts = { $lt: beforeTs, $gt: afterTs };
  query.room = roomName;
console.log(query);
  var cursor = db.mongo.messages.find(query); //.sort({_id: -1}).limit(amount).sort({_id: 1});
  //.toArray(callback)
  cursor.count(function(err, countNr) {
    if (err) callbackIter(err, null);
    else {
      var toSkip = Math.max(0,countNr-amount);
      console.log("    getRoomHistory: "+"found "+countNr+", requested "+amount+", skipping "+toSkip);
      cursor.sort({_id: 1}).skip(toSkip).forEach(callbackIter);
    }
  })
  //cursor.forEach(callbackIter);
}

function getReplacementId(xmppchildren) {
  //search for <replace id='bad1' xmlns='urn:xmpp:message-correct:0'/>
  if (!xmppchildren) return undefined;
  for(var k in xmppchildren) {
    if (xmppchildren[k].is('replace', 'urn:xmpp:message-correct:0')) {
      return xmppchildren[k].attrs.id;
    }
  }
  return undefined;
}

function postMsg(room, from, text, xmppid, jid, xmppchildren) {
  var ts = +new Date();
  
  if (!xmppid) xmppid = randId();
  
  // broadcast to XMPP and Socket.io
  broadcastRoom(room, 'msg', { by: from, msg: text, ts: ts, xmppid: xmppid, xmppchildren: xmppchildren });
  
  if (text !== null) {
      // store message in history database
      db.mongo.messages.save({
        by: from, room: room, msg: text, ts: ts, xmppid: xmppid, jid: jid, replacexmppid: getReplacementId(xmppchildren)
      }, function(err, msg) {
        console.log("   postMsg",err,msg);
      });
      
      var notify = getRoomProp(room, "notify-airgram", "").split(/,\s*/);
      for(var i in notify) {
        if(notify[i])pushToAirgram(notify[i], room+"/"+from+": "+text);
      }
      
      var notify2 = getRoomProp(room, "notify-boxcar", "").split(/,\s*/);
      for(var i in notify2) {
        if(notify2[i])pushToBoxcar(notify2[i], from+": "+text.substr(0,60), text);
      }
  }
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
function checkRoomNick(roomName, nick) {
  makeSureRoomExists(roomName);
  var mem= rooms[roomName].members, nickPrep = nick.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  for(var k in mem) {
    var nick2 = mem[k].nick.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    if (nickPrep == nick2) {
      return mem[k];
    }
  }
}

function getUserInfo(userJid, item) {
  var username = userJid.replace(/\/.*$/, "");
  if(!connectedUsers[username]) connectedUsers[username] = {};
  if (item) return connectedUsers[username][item];
  return connectedUsers[username];
}
function storeUserInfo(userJid, key, value) {
  var username = userJid.replace(/\/.*$/, "");
  var info = getUserInfo(userJid);
  if (key) info[key] = value;
  info.changed = ''+new Date();
  info.user = username;
  db.mongo.userinfo.update({user:username}, info, {upsert:true});
}


function getPresenceMessage(userData, wentOnline, optional_Status) {
  var presence = {};
  for(var i in userData) presence[i]=userData[i];
  presence.nick = userData.nick; presence.transport = userData.type; presence.id = userData.id;
  presence.status = optional_Status;
  presence.type = null;
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
    if (stanza.attrs.type == "error") {
      console.log("  !  received error stanza");
    } else if (( r = stanza.attrs.to.match(JABBER_ID_REGEX)  )) {
      if (stanza.attrs.type == "unavailable") {
        leaveRoom(r[1], stanza.attrs.from);
        xmppSendPresence(stanza.attrs.to, stanza.attrs.from, 'member', 'none', 'unavailable', [ '110' ]);
        
        return;
      }
      var xMucChild = stanza.getChild("x", "http://jabber.org/protocol/muc"), historyChild = null, passwdProvided = null, xmppshow = null;
      if (xMucChild) {
        historyChild = xMucChild.getChild("history");
        passwdProvided = xMucChild.getChildText("password");
        xmppshow = xMucChild.getChildText("show");
      }
      xmppJoinRoom(r[1], r[2], r[3], stanza.attrs.from, historyChild, passwdProvided, xmppshow);
    
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
    var r, error, xmucuser;
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
            
        } else if (( xmucuser = stanza.getChild("x", "http://jabber.org/protocol/muc#user") )) {
					handleInvitation(r[1], r[2], r[3], stanza.attrs.from, xmucuser);
					
        } else if (stanza.type == "groupchat") {
            if (( body = stanza.getChild('body') )) {
                // pass along regular messages
                
                var messageText = stanza.getChildText('body');
                if (messageText == "") return;
                
                var passChildren = [];
                for(var k in stanza.children)
                  if (!stanza.children[k].is("body")) passChildren.push(stanza.children[k]);
                
                if (messageText && (messageText.charAt(0)=="#" || messageText.charAt(0)=="!" || messageText.charAt(0)=="/")) {
                  runBotCommand(r, stanza.attrs.from, messageText, stanza.attrs.id);
                } else if (isMessageOverlyLong(rooms[r[1]], messageText)) {
                  storePastebin(messageText, function(newMsg) {
                    postMsg(r[1], user.nick, newMsg, stanza.attrs.id, stanza.attrs.from, passChildren);
                  });
                } else {
                  postMsg(r[1], user.nick, messageText, stanza.attrs.id, stanza.attrs.from, passChildren);
                }
                
            } else if (( subject = stanza.getChild('subject') )) {
                // room subject changes
                setRoomTopic(r[1], user.nick, stanza.getChildText('subject'));
                
            } else {
                //broadcastRoom(r[1], 'msg', { by: user.nick, msg: null, ts: +new Date(), xmppid: stanza.attrs.id });
                postMsg(r[1], user.nick, null, stanza.attrs.id, stanza.attrs.from, stanza.children);
            }
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
  if(!rooms[room]) return null;
  if(!rooms[room].properties)rooms[room].properties = {};
  var val = rooms[room].properties[propName];
  
  if (!val) return defaultVal; else {
    if(minimumIntVal) val=Math.max(minimumIntVal, parseInt(val, 10));
    
    return val;
  }
}

function xmppPresenceError(from, to, errorType, errorCondition) {
  var p = new xmpp.Element('presence', { from: from, to: to,  type: 'error' });
  p.c('x', { 'xmlns': XMLNS_MUC });
  p.c('error', { by: myJid, type: errorType })
    .c(errorCondition, { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' });
  return p;
}

function xmppJoinRoom(stanza_room, stanza_roomHost, stanza_roomNick, stanza_joinerJid, historyChild, passwdProvided, awayState) {
  var joiner = new JID(stanza_joinerJid);
  var mems = getRoomMembers(stanza_room);
  var rprefix = stanza_room+'@'+stanza_roomHost+'/';
  
  var alreadyIn = (stanza_joinerJid in mems);
  var passwdReq = getRoomProp(stanza_room, "password-required", "");
  var roomAcl = getRoomProp(stanza_room, "acl", "");
  if (roomAcl) roomAcl = roomAcl.split(/[;, ]+/);
  
  console.log("+++ JOIN: ",stanza_room,stanza_roomNick,"alreadyIn:"+alreadyIn,"passw/"+passwdProvided+"/"+passwdReq);
  
  if (!alreadyIn && passwdReq && passwdProvided!=passwdReq) {
    var p = xmppPresenceError(rprefix+stanza_roomNick, stanza_joinerJid, 'auth', 'not-authorized');
    xmppSend("presence error - passwd required", p);
    
    xmppErrMes(stanza_joinerJid, "Unable to join room "+rprefix+" - access denied (password).");
    return;
  }
  if (!alreadyIn && roomAcl && !roomAcl.some(function(allowedJid) { return allowedJid.toLowerCase() == joiner.bare(); })) {
    var p = xmppPresenceError(rprefix+stanza_roomNick, stanza_joinerJid, 'auth', 'registration-required');
    xmppSend("presence error - not allowed to join members-only room", p);

    xmppErrMes(stanza_joinerJid, "Unable to join room "+rprefix+" - access denied (members-only).");
    return;
  }
  
  var nickCollision = checkRoomNick(stanza_room, stanza_roomNick);
  if (stanza_roomNick == "roombot"
      || (  nickCollision && !( joiner.bare().equals(new JID(nickCollision.id).bare()) ) )
      ) {
      var p = xmppPresenceError(rprefix+stanza_roomNick, stanza_joinerJid, 'modify', 'conflict');
      xmppSend("presence error - nickname conflict with "+(nickCollision&&nickCollision.id), p);
      return;
  }
  
  
  for (var i in mems) {
    xmppSendPresence(rprefix+mems[i].nick, stanza_joinerJid, mems[i].xmppaffil||'member', mems[i].xmpprole||'participant', null, null, mems[i].id, mems[i].xmppshow);
  }
  broadcastRoom(stanza_room, 'presence', getPresenceMessage({ nick: stanza_roomNick, id: stanza_joinerJid, xmppshow: awayState }, true));
  
  xmppSendPresence(rprefix+'roombot', stanza_joinerJid, 'member', 'participant', null, null, 'roombot@teamwiki.de');
  var p = new xmpp.Element('presence', { from: rprefix+stanza_roomNick, to: stanza_joinerJid, id: stanza_joinerJid });
  p.c('status').t(getUserInfo(stanza_joinerJid, "statusMessage"));
  p.c('x', { xmlns: XMLNS_MUC + '#user' })
    .c('item', { affiliation: 'member', role: 'participant', jid: stanza_joinerJid }).up()
    .c('status', { code: '110' }).up() // references the user itself
    .c('status', { code: '100' }).up() // non-anonymous
    .c('status', { code: '170' }).up() // room is logged
    .c('status', { code: '210' });     // joined the room
  //if (stanza.getChild('c')) p.cnode(stanza.getChild('c'));
  //if (stanza.getChild('priority')) p.cnode(stanza.getChild('priority'));
  if(awayState) p.c('show').t(awayState);

  xmppSend("self presence stanza:",p);
  
  
  joinRoom(stanza_room, stanza_joinerJid, { nick: stanza_roomNick, msg: xmppMessageHandler, xmppshow: awayState });
  
  // avoid history-resend on away change (adium...)
  if (!alreadyIn || historyChild) {
    xmppSendHistory(stanza_room, stanza_joinerJid, historyChild);
    
    var subj_msg = xmppSubjectMessage(stanza_room, 'roombot', stanza_joinerJid, rooms[stanza_room].subject);
    xmppSend("subject message:", subj_msg);
    
  }
  
}

function handleInvitation(stanza_room, stanza_roomHost, stanza_roomNick, stanza_fromJid, xmucuser) {
  var c;
  if (( c = xmucuser.getChild("invite") )) {
		var invited = c.attr("to");
		var passwdReq = getRoomProp(stanza_room, "password-required", "");
		var roomAcl = getRoomProp(stanza_room, "acl", "");
		if (roomAcl) {
			roomAcl = roomAcl.split(/[;, ]+/);
			if (!roomAcl.some(function(j) { return j==invited; }))
				roomAcl.push(invited);
			setRoomProp(stanza_room, "acl",roomAcl.join("; "));
		}
		var msg = new xmpp.Element('message', { from: stanza_room+'@'+myJid, to: invited });
		msg.c('x', { xmlns: 'jabber:x:tstamp', tstamp: new Date().toISOString() });
    var inviteTag = msg.c('x', { xmlns:'http://jabber.org/protocol/muc#user'}).c('invite', {from: stanza_fromJid});
    if (c.getChild('reason')) inviteTag.c('reason').t(c.getChildText('reason'));
		
    xmppSend("sending INVITE message from "+stanza_fromJid+" to "+invited, msg);

		postMsg(stanza_room, "roombot", stanza_fromJid+" invited "+invited +" to this room", null);
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
                     data.type, stat, data.id, data.xmppshow||xmppshow, data.status);
    break;
  case "msg":
    var msg = xmppMessage(data.roomName, data.by, this.id, data.msg, data.xmppid, data.ts);
    if (data.xmppchildren)
      for(var i in data.xmppchildren)
        msg.cnode(data.xmppchildren[i].clone());
    
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
  else if (fromJid) p.c('status').t(getUserInfo(fromJid, "statusMessage"));
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
  console.log("->  Sending History: ", numstanzas, histsince, historyInfo);
  getRoomHistory(room, null, numstanzas, histsince, function(err, r) {
    if (err) {
      console.log("    error loading history", err);
      
    } else if(r) {
      //for (var i = results.length - 1; i >= 0; i--) {
      //  var r = results[i];
        var msg = xmppMessage(room, r.by, to, r.msg, r.xmppid, r.ts);
        try {
          if (r.replacexmppid) msg.c('replace', { xmlns: 'urn:xmpp:message-correct:0', id: r.replacexmppid });
          msg.c('delay', { xmlns: 'urn:xmpp:delay', from: room+'@'+myJid, stamp: new Date(r.ts).toISOString() });
          msg.c('x', { xmlns: 'urn:xmpp:delay', from: room+'@'+myJid, stamp: new Date(r.ts).toISOString() });
        } catch(e) {} //sometimes timestamp seems to be invalid
        xmppSend("Sending History", msg);
      //}
    } else {
      console.log("    done sending history");
    }
  })
}

function xmppMessage(room, nick, to, body, msgid, ts) {
  if(!msgid) msgid=randId();
  var msg = new xmpp.Element('message', { type: 'groupchat', from: room+'@'+myJid+'/'+nick, to: to, id: msgid });
  if (body) msg.c('body').t(body);
  
  // non-standard timestamp element, as seen on http://mail.jabber.org/pipermail/standards/2010-October/023918.html
  // to avoid doubled messages in miniConf because of time differences of few seconds between server + client
  msg.c('x', { xmlns: 'jabber:x:tstamp', tstamp: new Date(ts).toISOString() });
  
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
      { uri: 'http://paste.teamwiki.de/api/',
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
function subscribeToAirgram(email) {
  var request = require('request');
  if(!config.airgramAuth) {
    pushToAirgram(email, "Welcome to chat notifications :-)"); return;
  }
  
  request.post(
      {
        uri: "https://api.airgramapp.com/1/subscribe",
        form: { email: email },
        'auth': config.airgramAuth
      },
      function (error, response, body) {
      }
  );
}
function pushToAirgram(email, messageText) {
  var request = require('request');
  var apiEndpoint = (config.airgramAuth 
                  ? 'https://api.airgramapp.com/1/send' 
                  : 'https://api.airgramapp.com/1/send_as_guest');
  request.post(
      {
        uri: apiEndpoint, rejectUnauthorized: false, 
        form: { email: email, msg: messageText },
        'auth': config.airgramAuth
      },
      function (error, response, body) {
        //console.log("Airgram response: ",email,messageText,response,error,body);
        console.log("Airgram respone: ",body);
      }
  );
}
function pushToBoxcar(token, title, messageText) {
  var request = require('request');
  
  request.post(
      {
        uri: 'https://new.boxcar.io/api/notifications',
        form: {
          "user_credentials": token, "notification[title]": title, "notification[long_message]": messageText,
          "notification[sound]": "bell-triple", "notification[source_name]": myJid, 
          "notification[icon_url]": "https://raw.githubusercontent.com/max-weller/miniConf/master/Icons/AppIcon/Jabber64.png"
        } 
      },
      function (error, response, body) {
      }
  );
}


