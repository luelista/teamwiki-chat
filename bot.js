(function runBotCommand(r, stanza_fromJid, messageText, stanza_xmppid) {
// vim: expandtab:ts=2:sw=2
  var moment = require('moment');
  
  var theRoom = rooms[r[1]];
  var user = theRoom.members[stanza_fromJid];
  if (messageText[0] == '#')  {
    cmd='ticket'; broadcastFlag=false; params=messageText;
  } else {
    var temp = messageText.match(/^[\/!](\/)?([a-zA-Z0-9_.-]+)(\s+(.*))?$/), broadcastFlag=!temp[1], cmd=temp[2], params=temp[4];
  }

  function pad(a,b){return(1e15+a+"").slice(-b)}
  
  //var broadcastFlag = (messageText.charAt(0)=='.');
  
  function botsend(fromuser, str) {
    var fromNick = (fromuser && user && user.nick) ? user.nick : "roombot";
    if (broadcastFlag) {
      postMsg(r[1], fromNick, str, fromuser?stanza_xmppid:null);
    } else {
      var msg = xmppMessage(r[1], fromNick, stanza_fromJid, "[private] "+str, fromuser?stanza_xmppid:null, new Date());
      xmppSend("bot's sending a message", msg);
    }
  }
  
  function privmsg(fromuser, tonick, str) {
    var fromNick = (fromuser && user && user.nick) ? user.nick : "roombot";
    var recvs = 0;
    for(var k in theRoom.members) {
      if (theRoom.members[k].nick == tonick) {
        var msg = xmppMessage(r[1], fromNick, k, "[private] "+str);
        xmppSend("bot's sending a PRIVMSG", msg);
        recvs++;
      }
    }
    return recvs;
  }
  function sendToTicketTracker(projectGuid, ticketId, reporter, assigned_to, message, note) {
		var request = require('request');
		request.post(
				{
					uri: 'http://tickets.weller.io/new_from_chat?format=json',
					form: {
						project: projectGuid, reported_by: reporter, subject: message, ticketId: ticketId, note: note, assigned_to: assigned_to
					} 
				},
				function (error, response, body) {
					if (error) botsend(false, ""+error);
					else {
						var j=JSON.parse(body);
						console.log(body,j);
						broadcastFlag = true;
						botsend(true, messageText + "\n" + j['ticket_link']);
					}
				}
		);
	}


  if(cmd == 'forceinvite' || cmd == 'who' || cmd == 'forceremove' || cmd == 'op' || cmd == 'fullhistory' || cmd == 'msg' || cmd == 'w' || cmd == 'dump' || cmd == 'ticket') broadcastFlag = false;
  
  botsend(true, messageText);
  
  switch(cmd) {
    case "ping":
      //var msg = xmppMessage(r[1], 'roombot', stanza_fromJid, "I'm saying pong");
      //xmppSend("bot's sending PONG message", msg);
      botsend(false, 'My answer is pong.');
      break;
    case "ticket":
      var props = theRoom.properties || {};
      if (!props.ticketproject) {botsend(false, 'This room is not configured for tickets. ');}
			var m;
			if (m = params.match(/^\s*#([0-9]+)\s*([^]+)$/)) {
				var ticketId = m[1],  body = m[2];
        sendToTicketTracker(props.ticketproject, ticketId, user.nick, "","", body);
			} else if (m = params.match(/^\s*(?:##)\s*(?:@([^ :\n]+):?|([^:\n]+):)?([^\n]+)(?:\n([^]*))?$/)) {
				var  assignee = m[1] || m[2], subject = m[3], body = m[4];
        sendToTicketTracker(props.ticketproject, "", user.nick, assignee, subject, body);
			} else {
				botsend(false, 'error');
			}
			break;
    case "forceinvite":
      var a = params.split(/ /);
      xmppJoinRoom(r[1], r[2], a[0], a[1], null);
      break;
    
    case "kick":
      if (user.xmpprole != "moderator") break;
      var member = checkRoomNick(r[1], params);
      if (member) {
	leaveRoom(r[1], member.id);
	xmppSendPresence(r[1]+'@'+myJid+'/'+params, member.id, 'member', 'none', 'unavailable', [ '110' ]);
	console.log("ROOM OCCUPANT KICKED", r[1], stanza_fromJid, params);
      }
      break;
    
    case "topic":
      setRoomTopic(r[1], user && user.nick || "roombot", params);
      //var msg = xmppMessage(r[1], 'roombot', stanza_fromJid, "trying to set the topic "+r.join(',')+"...");
      //xmppSend("bot's sending ack message", msg);
      break;
    
    case "dump":
      botsend(false, JSON.stringify(theRoom, null, '   '));
      break;
    
    case "w": case "msg":
      var a = params.match( /^(?:([^\s]+)|\"([^"]+)\")\s+(.*)$/ );
      if (!a || !a[3]) break;
      var target = a[1]||a[2];
      if (!target) break;
      var recvs = privmsg(true, target, a[3]);
      if (recvs == 0) botsend(false, "User not found.");
      break;
    
    case "prop":
      var props = theRoom.properties || {}, m;
      if (!params) {
        var out="Room Properties:";
        for(var key in props) out+="\n"+key+" = " + props[key];
        botsend(false, out);
      } else if (( m = params.match(/^([a-z0-9.-]+)\s*=\s*(.*)$/) )) {
        //set property
        if (!broadcastFlag) { botsend(false, "Will set properties only publicly."); return; }
        setRoomProp(r[1], m[1], m[2]);
        botsend(false, m[1] +"=\""+m[2]+"\"");
      } else if (( m = params.match(/^([a-z0-9.-]+)(\?)?$/) )) {
        var val = props[m[1]];
        botsend(false, JSON.stringify(val));
      } else {
        botsend(false, "invalid syntax. use '/prop' to list all properties, '/prop hello?' to read property named 'hello', '/prop hello=world' to set value of property 'hello' to 'world'.");
      }
      break;
    
    case "airgram-subscribe":
      if ((!params) || params.indexOf("@")<1) { botsend(false, "Failed: please provide email address as parameter."); }
      params=params.trim();
      var subscribers = getRoomProp(r[1], "notify-airgram", "");
      if (subscribers.length>0) subscribers += ",";
      subscribers += params;
      setRoomProp(r[1], "notify-airgram", subscribers);
      subscribeToAirgram(params);
      botsend(false, "You're subscribed to this room now.");
      
    case "op":
      user.xmppaffil = 'admin'; user.xmpprole = 'moderator';
      broadcastRoom(r[1], 'presence', getPresenceMessage({ nick: user.nick, type: 'jabber', id: stanza_fromJid }, true));
      break;

    case "spruch":
      var spruch = fs.readFileSync('spruch.txt').toString().split('\n');
      var s = spruch[Math.floor(Math.random() * spruch.length)];
      botsend(false, s);
      break;

    case "time":
      var t = new Date(), h = ""+t.getHours(), m = ""+t.getMinutes(), sek = ""+t.getSeconds();
      if (m.length == 1) m="0"+m;  if (sek.length == 1) sek="0"+sek;
      var s = "Uhrenvergleich! Beim Gongschlag ist es " + h+":"+m+":"+sek + " Uhr ...";
      botsend(false, s);
      break;
    
    case "away":
      user.xmppshow = params||"xa";
      broadcastRoom(r[1], 'presence', getPresenceMessage({ nick: user.nick, type: 'jabber', id: stanza_fromJid }, true));
      break;
      
    case "status":case "s":
      if (params) {
        //var username = stanza_fromJid.replace(/\/.*$/, "");
        //db.mongo.userinfo.update({user:username}, {$set:{statusMessage: params, changed:''+new Date()}}, {upsert:true});
        storeUserInfo(stanza_fromJid, "statusMessage", params);
        broadcastRoom(r[1], 'presence', getPresenceMessage({ nick: user.nick, type: 'jabber', id: stanza_fromJid }, true));
        
      } else {
        var people = rooms[r[1]].members, ids = {};
        for(var k in people) ids[k.replace(/\/.*$/, "")] = '';
        db.mongo.userinfo.find({user:{$in:Object.keys(ids)}}, function(err,results) {
          for(var k in results) {
            ids[results[k].user] = results[k].statusMessage || '';
          }
          var out=[];    if(!broadcastFlag) out.push("");
          for(var k in ids) {
            out.push("* " +k+": "+ids[k]);
          }
          botsend(false, out.join('\r\n'));
        });
      }
      break;
    
    case "event":case "remind":case "remember":case "rem":
      var m=params.match(/^(me )?(tomorrow |(in |\+)([0-9]+) d(ays)? |([0-9]{1,2}\.[0-9]{1,2})\.? )?([0-9]{1,2}):([0-9]{1,2}) (.*)$/);
      if (!m) { botsend(false, 'I didn\'t understand your date format...\r\n  .remember [me] [tomorrow|in <n> days|<dd>.<mm>.] <hh>:<mm> <note to display>'); return; }
      
      var then = moment().startOf('day');
      if (m[2] == "tomorrow ") then=then.add('days', 1);
      if (m[4]) then=then.add('days', m[4]);
      if (m[6]) then=moment(m[6], 'DD.MM');
      then=then.hours(m[7]).minutes(m[8]);
      
      var diff = then.valueOf() - new Date().getTime();
      if (diff < 1) { botsend(false, 'Sorry, you already missed that event...'); return; }
      botsend(false,'I took a note to remember you in '+diff+' milliseconds');// '+ then.format('LLLL'));
      
      broadcastFlag = !m[1];
      
      var events = getRoomProp(theRoom.name, "event-notifiers", []);

      var id = setTimeout(function() {
        botsend(false, m[9]);
      }, diff);
      events.push({ dateTime: then.format("ddd, H:mm"), timestamp: then.valueOf(), notice: m[9], timer: id });
      setRoomProp(theRoom.name, "event-notifiers", events);
      break;
    
    case "events":
      var events = getRoomProp(theRoom.name, "event-notifiers", []);
      for(var i in events) botsend(false, events[i].dateTime + " - " + events[i].notice);
      if (events.length == 0) botsend(false, "No events there");
      
      break;
    case "start":
      theRoom.stopwatchStart = new Date();
      break;
    
    case "stop":
      var diff = moment.duration(new Date() - theRoom.stopwatchStart, "ms");
      var txt = "" + (diff.asDays() > 1 ? Math.floor(diff.asDays())+" days " : "") + (diff.hours() > 0 ? pad(diff.hours(),2)+":" : "") + pad(diff.minutes(),2)+":"  + pad(diff.seconds(),2) ;
      botsend(false, "stopwatch: "+txt);
      break;
    
    case "tea":
      if (!params) {
        if (user.teaTimer) {
          var diff=moment.duration(user.teaTimer-new Date());
          botsend(false, user.nick+": Your tea will be ready in "+(diff.asMinutes()>=1?Math.floor(diff.asMinutes())+" minutes and ":"")+diff.seconds()+" seconds");
        }
        else botsend(false, "You don't have a tea timer running");
      }
      if(user.teaTimerHandle){clearTimeout(user.teaTimerHandle);user.teaTimer=null;user.teaTimerHandle=null; }
      
      var m=params.match(/^([0-9]{1,2})(?:[:.]([0-9]{1,2}))?(.*)$/);
      if (!m) { botsend(false, 'I didn\'t understand your date format...\r\n  /tea <mm>[:<ss>] [<note to display>]'); return; }
      var interval = m[1]*60000;
      if(m[2]) interval += m[2]*1000;
      user.teaTimer = (new Date()).valueOf()+interval;
      
      
      user.teaTimerHandle = setTimeout(function() {
        botsend(false, m[3]||user.nick+": Your tea is ready!");
        user.teaTimer = null; user.teaTimerHandle = null;
      }, interval);
      break;
      
    case "help": case "hilfe":
      botsend(false,
                  'I listen to /command and //command. //commands are answered in private, /commands publicly. '+
              '\r\nThese are words I understand:'+
              '\r\n  /ping'+
              '\r\n  /time'+
              '\r\n  /spruch'+
              '\r\n  /topic <new room subject>'+
              '\r\n  /status <your new status>'+
              '\r\n  /status'+
              '\r\n  /remind [me] [tomorrow|in <n> days|<dd>.<mm>.] <hh>:<mm> <note to display>'+
              '\r\n  /tea <mm>[:<ss>] [<note to display>]'+
              '\r\n  /start, /stop (simple stop watch)'+
              '\r\n  /msg "<nickname>" <private message to send>'+
              '\r\n  /prop <property name>[ = <property value>]'+
              '\r\n  /s, /rem are valid abbreviations'+
              '\r\n  /fullhistory <number of stanzas>');
      break;
    
    case "who":
      broadcastFlag = false;
      var nicks = {};
      for(var  i in theRoom.members) {
        var m = theRoom.members[i];
        if(!nicks[m.nick]) nicks[m.nick] = [];
        nicks[m.nick].push(m.id);
      }
      var out="";
      for(var nick in nicks) out+="\n"+nick+" --> "+(nicks[nick].join(", "));
      botsend(false, out);
      break;
    
    case "fullhistory":
      broadcastFlag = false;
      if (parseInt(params,10)<=1) { botsend(false, 'Please tell me the number of stanzas you want.'); break; }
      xmppSendHistory(r[1], stanza_fromJid, {attrs: {maxstanzas: parseInt(params,10) }} );
      break;
    
    case "hist":case "history":
      //broadcastFlag = false;
      var numstanzas = parseInt(params,10);
      if (!numstanzas || numstanzas<1 || numstanzas>15) numstanzas=5;
      var histsince = null;
      var outStr = "";
      getRoomHistory(r[1], null, numstanzas, histsince, function(err, r) {
        if (err) {
          console.log("    /hist: error loading history", err);
          botsend(false, "error loading history ("+err+")");
        } else if(r) {
          outStr += "["+(new Date(r.ts).toString())+"] "+r.by+": "+r.msg+"\r\n";
        } else {
          console.log("    done collecting history");
          botsend(false, outStr);
        }
      });
      break;
    default:
      broadcastFlag = false;
      botsend(false, "I don't know about "+cmd+"...");
      break;
    
  }
  
  
  
  
})
