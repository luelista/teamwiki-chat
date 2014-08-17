
var crypto = require ('crypto');
var fs = require ('fs');
var GCM = require ('./gcm');
var xmpp = require('node-xmpp');

var config = require('./config');
var db = require ('./dbconnect.js')(config);
var gcm = new GCM(config.gcm_api_key);

var privateKey = fs.readFileSync(config.privateKey).toString();
var certificate = fs.readFileSync(config.certificate).toString();
var caCert = [ ];//fs.readFileSync(config.caCert1).toString(),
//fs.readFileSync(config.caCert2).toString() ];

var connection = new xmpp.Client({
  jid: 'anonymous@teamwiki.de',
  host: 'teamwiki.de',
  port: 5222  //config.xmppPort
});
connection.on('error', function(err) {
  console.log("Jabber Connection Error: ", err);
});


if (config.xmppComponentJid) {
  var component = new xmpp.Component({
    jid: config.xmppComponentJid,
    password: config.xmppComponentSecret,
    host: config.xmppHost,
    port: Number(config.xmppPort),
    reconnect: true
  });
}


var URL_ROOT = config.url_root;

var express = require('express')
var app = express()
, http = require('http')
, https = require('https')
, server = http.createServer(
    //{ key: privateKey, cert: certificate, ca: caCert }, 
    app);


var io = require('socket.io').listen(server);

var runtimeId = Math.floor(Math.random()*100000)+1;

var lastUpload = "";

io.set('log level', 2); 
server.listen(config.server_port);

app.use(express.bodyParser());
app.use('/assets', express.static(__dirname + '/assets'));
app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});
app.get('/client.js', function (req, res) {
  res.sendfile(__dirname + '/client.js');
});
app.get('/file_upload.client.js', function (req, res) {
  res.sendfile(__dirname + '/file_upload.client.js');
});
app.get('/background', function (req, res) {
  res.sendfile(__dirname + '/background.html');
});
app.get('/chrome', function (req, res) {
  res.sendfile(__dirname + '/extension.crx');
});
app.get('/android', function (req, res) {
  res.sendfile(__dirname + '/extension.apk');
});
app.get('/jabber', function (req, res) {
  res.sendfile(__dirname + '/jabberform.html');
});
app.post('/jabber', function (req, res) {
  
  //user to be registered name & pass
  var newUserName = req.body.username;
  var newUserPass = req.body.password;

  //Stream
  var iq = "<iq type='set' id='reg2'><query xmlns='jabber:iq:register'><username>" + newUserName + "</username><password>" + newUserPass + "</password></query></iq>";

  //Send
  connection.send(iq);

  res.send(200, "You might have a new account now!");
  
});
connection.on('stanza', function(stanza) {
  console.log("connection stanza: ",stanza);
});
app.get(/^\/uploads\/([a-z0-9]+).*$/, function (req, res) {
  var base = __dirname + '/uploads/' + req.params[0] + '/';
  fs.readdir(base, function(err, files) {
    //console.log(err,files);
    for (var i = 0; i < files.length; i++) {
      if (files[i] != "." && files[i] != "..") {
        res.sendfile(base + files[i]);
        return;
      }
    }
    res.status(404).sendfile('./404_attachment.html');
  });
});
app.post('/upload_media', function (req, res) {
  //console.log(req);
  if (req.files && req.files['media'] && req.files['media'].size > 0) {
    var target = "uploads/" + getUploadId() + "/";
    fs.mkdir(target, function() {
      target += req.files['media'].name.replace(/[^a-zA-Z0-9._:-]/g, "_");
      fs.rename(req.files['media'].path, target);
      res.send({success : true, fileSpec: target});
      lastUpload = target;
    });
  } else {
    res.send({success : false});
  }
});

app.get('*', function(req, res){
  res.status(404).sendfile('./404.html');
});

var uploadIdCounter = 1;
var clientIdCounter = 1;

var connectedUsers = {};
var connectedClients = {};

var rooms = {};

io.sockets.on('connection', function (socket) {
  var username = null, friends = [], clientId = null, room = "";
  socket.type = 'web';
  socket.on('oauth', function (data, ack) {
    console.log('try to connect as '+data.username,db.connection);
    db.connection.query(db.SQL_GET_USER_INFO, [data.username], function(err, results) {
      console.log('-> query res: ', err, results);
      if (err) {
        socket.emit('eval', 'console.log("Database error occured - please try again later\n'+err+'");');
        return;
      }
      clientId = clientIdCounter++; connectedClients[clientId] = { user: username, socket: socket, ua: data.userAgent };
      if (results.length != 1) {
        ack({success:false, error:"userNotFound"});
        return;
      }
      var hash = crypto.createHash('sha1').update(results[0].id+"-"+results[0].username+"-"+results[0].password+'-'+config.secret_hash_token).digest('hex');
      if (hash != data.token) {
        ack({success:false, error:"userNotFound"});
        return;
      }
      username = results[0].username;
      connectedClients[clientId].user = username;
      connectedUsers[username] = (connectedUsers[username] != null) ? (connectedUsers[username] + 1) : 1;
      io.sockets.in('is_' + username).emit('online status', {type: '- you joined on another device', runtimeId: runtimeId, by: username, onlines: connectedUsers, ts: +new Date()});
      socket.join('is_' + username);
      
      //broadcastOnlineStatus('joined');
      socketJoinRoom("chat");
      socket.emit('software update', {version: 2, runtimeId: runtimeId});
    });
    
  });
  
  socket.on('disconnect', function() {
    //var joinMsg = {type: 'announcement', by: username, msg: '*'+username+' left*', ts:+new Date(), mentions: [], tags: []};
    if (username) {
      connectedUsers[username] = (connectedUsers[username] != null) ? (connectedUsers[username] - 1) : 0;
      //socket.broadcast.to('friends_of_' + username).emit('sysmsg', {type: 'joined', by: username});
      //postMsg(joinMsg);
      //broadcastOnlineStatus('left');
      io.sockets.in('is_' + username).emit('online status', {type: '- you left on another device', runtimeId: runtimeId, by: username, onlines: connectedUsers, ts: +new Date()});
    }
    connectedClients[clientId] = null;
    leaveRoom(room, 's_' + clientId);
  });
  
  socket.emit('auth required');
  
  
  function socketJoinRoom(nroom) {
    room = nroom;
    var userData = { nick: username, type: 'web' };
    broadcastRoom(room, 'presence', getPresenceMessage(userData, true));
    joinRoom(room, 's_' + clientId, userData);
    socket.join('room_' + room);
    socket.emit('online status', { type: 'welcome', room: room, ts: +new Date() });
    var users = getRoomMembers(nroom);
    for(var i in users) {
      socket.emit('presence', getPresenceMessage(users[i], true));
    }
  }
  socket.on('join room', function(data) {
    if (typeof data == "string") socketJoinRoom(data);
  });
  
  socket.on('request history', function(data, callback) {
    getRoomHistory(data.room, data.beforeTs, 10, function(err, results) {
      if (err) {
        console.log("error loading history", err);
        callback({historyData : [], error:true});
      } else {
        callback({historyData : results});
      }
    })
  });
  
  socket.on('register gcm', function (data) {
    db.mongo.gcmRegistrations.findAndModify({ 
      query: { user: username, id: data.GCMRegistrationId }, 
      update: { user: username, id: data.GCMRegistrationId },
      upsert: true
    }, function(err, doc){
      console.log("gcm registration: ", err, doc);
    });
  });
  
  socket.on('command', function (data) {
    var cmd = data.cmd.split(" ");
    switch(cmd[0]) {
    case "/lcl":
      for(var i in connectedClients)
        if (connectedClients.hasOwnProperty(i) && connectedClients[i] != null)
          sendSysMsg("Client #"+i+": "+connectedClients[i].user+" / "+connectedClients[i].socket+" / "+connectedClients[i].ua)
      break;
    case "/restartServer":
      io.sockets.emit('online status', {type: "Server is going to restart", by: "", onlines: connectedUsers, ts: +new Date()});
      throw new Error("Restart requested!");
      break;
    case "/wall":
      io.sockets.emit('online status', {type: data.cmd.substr(5), by: "", onlines: connectedUsers, ts: +new Date()});
      break;
    case "/evalOn":
      var target=cmd[1];
      cmd = cmd.slice(2).join(" ");
      var cl = connectedClients[target];
      if (cl && cl.socket) {
        cl.socket.emit('eval', {js: cmd}, function(result) {
          sendSysMsg("result: "+result);
        });
      } else {
        sendSysMsg("client not found");
      }
      break;
    case "/lupl":
      sendSysMsg("last upload: <a href='"+URL_ROOT+lastUpload+"'>"+URL_ROOT+lastUpload+"</a>&lt;&lt;&lt;");
      break;
    }
  });
  
  socket.on('chatmsg', function (data) {
    console.log(data);
    if (!username) { console.log("not authenticated - discarding");socket.emit('auth required'); return; }
    
    var msg = { msg: data.text }; //parseMsg(data.text);
    msg.imgs = data.imgs;
    msg.tmp_id = data.tmp_id;
    msg.room = room;
    //postMsg(msg, data.tmp_id, data.try_update);
    postMsg(room, username, msg.msg);
  });
  function sendSysMsg(text) {
    io.sockets.in('is_' + username).emit('sysmsg', { _id: "sys_"+(+new Date()), type: "announcement", by: "&lt;SYS&gt;", msg: text, imgs: [], mentions: [], recipient: username, tags: [] });
  }
});

function getRoomHistory(roomName, beforeTs, amount, callback) {
  var query = {};
  if (beforeTs) query.ts = { $lt: beforeTs };
  query.room = roomName;

  var cursor = db.mongo.messages.find(query).sort({_id: -1}).limit(amount).toArray(callback)
}

function postMsg(room, from, text, xmppid) {
  var ts = +new Date();
  
  if (!text) console.log("skipping empty message", room,from,text,xmppid);
  if (!xmppid) xmppid = randId();
  
  // broadcast to XMPP and Socket.io
  broadcastRoom(room, 'msg', { by: from, msg: text, ts: ts, xmppid: xmppid });
  
  // store message in history database
  db.mongo.messages.save({
    by: from, room: room, msg: text, ts: ts, xmppid: xmppid
  }, function(err, msg) {
    console.log("postMsg",err,msg);
    
  });
}

// New Room Management

function joinRoom(roomName, userId, data) {
  if (! rooms[roomName]) rooms[roomName] = {};
  data.id = userId;
  rooms[roomName][userId] = data;
}
function leaveRoom(roomName, userId) {
  if (! rooms[roomName] || ! rooms[roomName][userId]) return;
  var userData = rooms[roomName][userId];
  delete rooms[roomName][userId];
  if (userData.nick)
    broadcastRoom(roomName, 'presence', getPresenceMessage(userData, false));
}
function broadcastRoom(roomName, msgType, data) {
  console.log("broadcast",roomName,msgType);
  if (! rooms[roomName]) return;
  data.roomName = roomName;
  // broadcast to Socket.IO
  io.sockets.in('room_' + roomName).emit(msgType, data);
  for (var i in rooms[roomName]) {
    console.log("...",i);
    if (rooms[roomName][i].msg) {
        // send to XMPP via xmppMessageHandler
      rooms[roomName][i].msg(msgType, data);
    }
  }
}
function getRoomMembers(roomName) {
  if (! rooms[roomName]) rooms[roomName] = {};
  return rooms[roomName];
}


function getPresenceMessage(userData, wentOnline) {
  var presence = { nick: userData.nick, transport: userData.type, affil: 'member', role: 'none' };
  if (!wentOnline) presence.type = 'unavailable';
  return presence;
}



function sendViaGCM(toUser, msg) {
  db.mongo.gcmRegistrations.find({ user: toUser }).toArray(function(err, results) {
    gcm.send({
      registration_ids: results.map(function(a) { return a.id; }),
      collapse_key: "msgfrom_" + msg.by,
      time_to_live: 180,
      data: {
        content_title: msg.by + " messaged you:",
        content_text: msg.msg
      }
    }, function(err, body) {
      console.log("sent via gcm - err: ", err, "result: ", body);
    });
  });
}

function getUploadId() {
  var token = "" + runtimeId + new Date() + (++uploadIdCounter);
  return crypto.createHash("md5").update(token).digest("hex").substr(0,16);
}



//hilfs-server
/*
  http.createServer(function(request,response) {
  response.writeHead(302, "Moved Temp", {Location: "https://teamwiki.de/chat"});
  response.end();
  }).listen(8880);
*/


var XMLNS_MUC = "http://jabber.org/protocol/muc";
var JABBER_ID_REGEX = /([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)/;
var JABBER_ID_REGEX2 = /([a-zA-Z0-9_.-]+)@([a-zA-Z0-9_.-]+)/;
var myJid = config.xmppComponentJid;

// jabber component

if (component) {
  component.on('online', function() {
    console.log('Component is online')
    component.on('stanza', onXmppStanza)
    // nodejs has nothing left to do and will exit
    //component.end()
  });
  
  component.on('error', function(e) {
    console.error("XMPP error: ", e);
  });
}

function onXmppStanza(stanza) {
  console.log('Received stanza: ', stanza.toString());
  if (stanza.is('iq') && stanza.attrs.type == 'get') {
    var recp = stanza.attrs.to.split(/@/);
    if (recp.length == 1 && recp[0] == myJid) {
      if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#info")) {
        var disco = discoReply(stanza, query), d = disco.getChild('query');
        d.c('identity', { category: 'conference', type: 'text', name: 'TeamWiki Chat System' });
        d.c('feature', { 'var': 'http://jabber.org/protocol/muc' });
        xmppSend("sent info stanza : ", disco);
      }
      if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#items")) {
        var disco = discoReply(stanza, query), d = disco.getChild('query');
        for (var i in rooms)
          d.c('item', { jid: i + '@' + myJid, name: i });
        xmppSend("sent items stanza : ", disco);
      }
    }
    if (recp.length == 2 && recp[1] == myJid) {
      var room = rooms[recp[0]];
      if (room) {
        if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#info")) {
          var disco = discoReply(stanza, query), d = disco.getChild('query');
          d.c('identity', { category: 'conference', type: 'text', name: 'The Chat' });
          d.c('feature', { 'var': 'muc_open' });
          d.c('feature', { 'var': 'muc_permanent' });
          d.c('feature', { 'var': 'muc_public' });
          xmppSend("sent info stanza : ", disco);
        }
        if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#items")) {
          var disco = discoReply(stanza, query), d = disco.getChild('query');
          for(var i in room)
            d.c('item', { jid: stanza.attrs.to + '/' + room[i].nick });
          xmppSend("sent items stanza : ", disco);
        }
      } else {
        var disco = discoReply(stanza, query), d = disco.getChild('query');
        xmppSend("sent empty result stanza : ", disco);
      }
    }
    if (recp = stanza.attrs.to.match(JABBER_ID_REGEX)) {
      if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#info")) {
        var disco = discoReply(stanza, query), d = disco.getChild('query');
        d.c('identity', { category: 'client', type: 'pc' });
        d.c('feature', { 'var': XMLNS_MUC });
        // TODO XEP-0045 6.7 - contact the client for real data
        xmppSend("sent info stanza : ", disco);
      }
      if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#items")) {
        var disco = discoReply(stanza, query), d = disco.getChild('query');
        xmppSend("sent items stanza : ", disco);
      }
      if (query = stanza.getChild('vCard', "vcard-temp")) {
        var iq = new xmpp.Element('iq', 
                                  { type: 'error', from: myJid, to: stanza.attrs.from, id: stanza.attrs.id });
        xmppSend("sent error stanza : ", iq);
      }
      
    }
  }
  if (stanza.is('presence')) {
    var r;
    if (r = stanza.attrs.to.match(JABBER_ID_REGEX)) {
      if (stanza.attrs.type == "unavailable") {
        leaveRoom(r[1], stanza.attrs.from);
        xmppSendPresence(stanza.attrs.to, stanza.attrs.from, 'member', 'none', 'unavailable', [ '110' ]);
        
        return;
      }
      console.log("JOIN: ",r[1],r[3]);
      var mems = getRoomMembers(r[1]);
      var rprefix = r[1]+'@'+r[2]+'/';
      for (var i in mems) {
        xmppSendPresence(rprefix+mems[i].nick, stanza.attrs.from, 'member', 'participant');
      }
      broadcastRoom(r[1], 'presence', getPresenceMessage({ nick: r[3], type: 'jabber' }, true));
      
      xmppSendPresence(rprefix+'roombot', stanza.attrs.from, 'member', 'participant');
      var p = new xmpp.Element('presence', { from: stanza.attrs.to, to: stanza.attrs.from, id: stanza.attrs.id });
      p.c('x', { xmlns: XMLNS_MUC + '#user' })
        .c('item', { affiliation: 'member', role: 'participant', jid: stanza.attrs.from }).up()
        .c('status', { code: '110' }).up() // references the user itself
        .c('status', { code: '170' }).up() // room is logged
        .c('status', { code: '210' });     // joined the room
      if (stanza.getChild('c')) p.cnode(stanza.getChild('c'));
      if (stanza.getChild('priority')) p.cnode(stanza.getChild('priority'));

      xmppSend("self presence stanza:",p);
      
      joinRoom(r[1], stanza.attrs.from, { type: 'jabber', nick: r[3], msg: xmppMessageHandler });
      
      xmppSendHistory(r[1], stanza.attrs.from);
    } else {
      var p = new xmpp.Element('presence', { from: stanza.attrs.to, to: stanza.attrs.from, id: stanza.attrs.id, type: 'error' });
      p.c('error', { by: myJid, type: 'modify' })
        .c('jid-malformed', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' });
      xmppSend("presence error", p);
    }
  }
  if (stanza.is('message')) {
    var r;
    console.log("incoming message");
    if (r = stanza.attrs.to.match(JABBER_ID_REGEX2)) {
      var users = getRoomMembers(r[1]), user = users[stanza.attrs.from];
      console.log("TO(regexResult):",r, "USERS(RoomMembers):", users, "FROM:",stanza.attrs.from);
      if (user) {
        postMsg(r[1], user.nick, stanza.getChildText('body'), stanza.attrs.id);
        //var data = { nick: user.nick, msg: stanza.getChildText('body') };
        //broadcastRoom(r[1], 'message', data);
      }
    }
  }
}



function xmppMessageHandler(msgType, data) {
  switch(msgType) {
  case "presence":
    xmppSendPresence(data.roomName+'@'+myJid+'/'+data.nick, this.id, 'member', 'participant', data.type);
    break;
  case "msg":
    var msg = xmppMessage(data.roomName, data.by, this.id, data.msg, data.xmppid);
    xmppSend("sending message", msg);
  }
}

function xmppSendPresence(from, to, affil, role, type, status) {
  var p = new xmpp.Element('presence', { from: from, to: to, id: randId() });
  if (type) p.attrs.type = type;
  var x = p.c('x', { xmlns: XMLNS_MUC + '#user' });
  x.c('item', { affiliation: affil, role: role });
  if(status) {
    for(var i=0; i<status.length; i++) x.c('status', { code: status[i] });
  }
  xmppSend("xmppSendPresence", p);
}

function xmppSendHistory(room, to) {
  getRoomHistory(room, null, 100, function(err, results) {
    if (err) {
      console.log("error loading history", err);
      
    } else {
      for (var i = results.length - 1; i >= 0; i--) {
        var r = results[i];
        var msg = xmppMessage(room, r.by, to, r.msg);
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

function xmppSend(debug, msg) {
  console.log(">> "+debug, msg.toString());
  component.send(msg);
}

function randId() {
  return Math.floor(Math.random()*10000000)+1000000;
}


function discoReply(stanza, query) {
  var disco = new xmpp.Element('iq', 
                               { type: 'result', from: myJid, to: stanza.attrs.from, id: stanza.attrs.id });
  disco.c('query', { xmlns: query.attrs.xmlns });
  return disco;
}




