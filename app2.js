
var request = require('request');
var db = require ('./dbconnect.js');
var crypto = require ('crypto');
var fs = require ('fs');
var GCM = require ('./gcm');


var config = require('./config');
var gcm = new GCM(config.gcm_api_key);

var privateKey = fs.readFileSync(config.privateKey).toString();
var certificate = fs.readFileSync(config.certificate).toString();
var caCert = [ fs.readFileSync(config.caCert1).toString(),
                fs.readFileSync(config.caCert2).toString() ];


var URL_ROOT = config.url_root;


var express = require('express')
var app = express()
  , http = require('http')
  , https = require('https')
  , server = https.createServer({ key: privateKey, cert: certificate, ca: caCert }, app);


var io = require('socket.io').listen(server);

var runtimeId = Math.floor(Math.random()*100000)+1;

io.set('log level', 2); 
server.listen(8003);

app.use(express.bodyParser());

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
app.get('/register_server', function (req, res) {
  //res.send("<html><body><form action='/register_server' method='post'>);
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

var friendicaServers = {};

io.sockets.on('connection', function (socket) {
  var username = null, friends = [], clientId = null, filter = "";
  socket.on('oauth', function (data, ack) {
    console.log('try to connect as '+data.username);
    requestAuthentication(data.username, data.token, function(result) {
        if (result.status != "OK") {
          ack({success:false, error:"userNotFound"});
          return;
        }
        clientId = clientIdCounter++; connectedClients[clientId] = { user: username, socket: socket, ua: data.userAgent };
        
        username = result.self.url;
        connectedClients[clientId].user = username;
        connectedUsers[username] = (connectedUsers[username] != null) ? (connectedUsers[username] + 1) : 1;
        io.sockets.in('is_' + username).emit('online status', {type: '- you joined on another device', runtimeId: runtimeId, by: username, onlines: connectedUsers, ts: +new Date()});
        socket.join('is_' + username);
        var cc=0;
        for(var key in result.friends) {
					friends.push(result.friends[key]); socket.join('friends_of_' + key); cc++;
				}
				console.log('...subscribing to friends: ' + cc);
				//if (results.length > 0) {
					ack({success:true});
				//}
        
        broadcastOnlineStatus('joined');
        onSetFilter("");
        socket.emit('software update', {version: 2});
    });
    
  });
  
  socket.on('disconnect', function() {
    //var joinMsg = {type: 'announcement', by: username, msg: '*'+username+' left*', ts:+new Date(), mentions: [], tags: []};
    connectedUsers[username] = (connectedUsers[username] != null) ? (connectedUsers[username] - 1) : 0;
    //socket.broadcast.to('friends_of_' + username).emit('sysmsg', {type: 'joined', by: username});
    //postMsg(joinMsg);
    broadcastOnlineStatus('left');
    io.sockets.in('is_' + username).emit('online status', {type: '- you left on another device', runtimeId: runtimeId, by: username, onlines: connectedUsers, ts: +new Date()});
    connectedClients[clientId] = null;
  });
  
  socket.emit('auth required');
  
  function onSetFilter(dfilter) {
      filter = parseMsg(dfilter);
      console.log("setFilter",filter);
      socket.emit('online status', {type: 'welcome', filter: filter, runtimeId: runtimeId, by: username, onlines: connectedUsers, ts: +new Date()});
  }
  
  socket.on('set filter', function(data) {
      if (typeof data == "string") onSetFilter(data);
  });
  
  socket.on('request history', function(data, callback) {
      var query;
      if (filter.type == "dm") {
        query = { ts: { $lt: data.beforeTs }, type: 'dm', $or : [
            { by: username, mentions: { $in: filter.mentions } },
            { by: { $in: filter.mentions }, mentions: username }
        ]};
      } else {
        var myFriends = friends.filter(function(e) { if (filter.mentionsExc.indexOf(e) == -1) return true; });
        if (filter.mentions.length > 0) myFriends = myFriends.filter(function(e) { if (filter.mentions.indexOf(e) > -1) return true; });
        
        query = { ts: { $lt: data.beforeTs }, $or : [
            { by: username },
            { by: { $in: myFriends }, type: { $in: ['pub', 'announcement'] } },
            { mentions: username  }
        ]};
        
        if (filter.tagsExc.length > 0)
          query.tags = { $nin: filter.tagsExc };
        if (filter.tags.length > 0)
          query.tags = { $in: filter.tags };
        
      }
      var cursor = db.mongo.messages.find(query).sort({_id: -1}).limit(10).toArray(function(err, results) {
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
      }
  });
  
  socket.on('chatmsg', function (data) {
    console.log(data);
    if (!username) { console.log("not authenticated - discarding");socket.emit('auth required'); return; }
    
    var msg = parseMsg(data.text);
    msg.imgs = data.imgs;
    msg.tmp_id = data.tmp_id;
    postMsg(msg, data.tmp_id, data.try_update);
  });
  function broadcastOnlineStatus(stat) {
      socket.broadcast.to('friends_of_' + username).emit('online status', {type: stat, by: username, onlines: connectedUsers, ts: +new Date()});
  }
  function sendSysMsg(text) {
      io.sockets.in('is_' + username).emit('sysmsg', { _id: "sys_"+(+new Date()), type: "announcement", by: "&lt;SYS&gt;", msg: text, imgs: [], mentions: [], recipient: username, tags: [] });
  }
  function postMsg(p_msg, tmp_id, try_update) {
    p_msg.by = username;
    db.mongo.messages.findAndModify({
        query: {tmp_id: tmp_id, by: username},
        update: p_msg,
        'new': true,
        upsert: true
    }, function(err, msg) {
        console.log(err,msg);
        if (typeof msg != "object") msg = p_msg;
        if (msg.type == "pub" || msg.type == "announcement") {
            socket.broadcast.to('friends_of_' + username).emit('public chatmsg', msg);
        }
        if (msg.mentions.length > 0) {
            for (var i = 0, max = msg.mentions.length; i < max; i++) {
                socket.broadcast.to('is_' + msg.mentions[i]).emit('mention', msg);
                sendViaGCM(msg.mentions[i], msg);
            }
        }
        // echo it back
        if (tmp_id) msg.tmp_id = tmp_id;
        io.sockets.in('is_' + username).emit('echomsg', msg);
    });
  }
});

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

function parseMsg(str) {
    var msg = { msg: str, ts: +new Date(), mentions: [], tags: [], mentionsExc: [], tagsExc: [] }, pattern, r, s;
    
    // match mentions
    pattern = new RegExp(/@(?:([a-z0-9_.-]+)\b|<([^>]+)>)/g);
    while ((r = pattern.exec(str)) && (s = r[1] || r[2]))
        if (s.charAt(0) == "-") msg.mentionsExc.push(s.substr(1)); else msg.mentions.push(s);
    
    // match tags
    pattern = new RegExp(/#(?:([a-z0-9_.-]+)\b|<([^>]+)>)/g);
    while ((r = pattern.exec(str)) && (s = r[1] || r[2]))
        if (s.charAt(0) == "-") msg.tagsExc.push(s.substr(1)); else msg.tags.push(s);
    
    // match direct message
    if(r = str.match(/^@@(?:([a-z0-9_.-]+)\b|<([^>]+)>)/)) {
        msg.type = "dm"; msg.recipient = r[1] || r[2];// msg.mentions.push(r[1]);
    } else {
        msg.type = "pub";
    }
    return msg;
}

function getUploadId() {
    var token = "" + runtimeId + new Date() + (++uploadIdCounter);
    return crypto.createHash("md5").update(token).digest("hex").substr(0,16);
}

function requestFriendicaChatServer(friendicaServerDomain, callback) {
	if (friendicaServers[friendicaServerDomain]) {
		callback(friendicaServers[friendicaServerDomain]);
	}
	request({uri: "https://" + friendicaServerDomain + "/simplechat/?m=get_chat_server"}, function(error, response, body) {
      body = JSON.parse(body);
      friendicaServers[friendicaServerDomain] = body.chat_server_url;
      callback(body.chat_server_url);
    });
}

function requestAuthentication(username, accessToken, callback) {
	var authUrl = username.substr(0, username.indexOf("/profile")) + "/simplechat/?m=authenticate&access_token=" + username + "," + accessToken;
	console.log("auth url:",authUrl);
	request({uri: authUrl}, function(error, response, body) {
      console.log("auth response", body);
      body = JSON.parse(body);
      callback(body);
    });
}