(function runBotCommand(r, stanza_fromJid, messageText, stanza_xmppid) {
  var moment = require('moment');
  
  var user = rooms[r[1]].members[stanza_fromJid];
  var temp = messageText.match(/^[.#]([a-zA-Z0-9_.-]+)(\s+(.*))?$/), cmd=temp[1], params=temp[3];
  
  var broadcastFlag = (messageText.charAt(0)=='.');
  
  function botsend(fromuser, str) {
    var fromNick = (fromuser && user && user.nick) ? user.nick : "roombot";
    if (broadcastFlag) {
      postMsg(r[1], fromNick, str, fromuser?stanza_xmppid:null);
    } else {
      var msg = xmppMessage(r[1], fromNick, stanza_fromJid, "[private] "+str);
      xmppSend("bot's sending a message", msg);
    }
  }
  
  if(cmd == 'forceinvite' || cmd == 'op') broadcastFlag = false;
  
  botsend(true, messageText);
  
  switch(cmd) {
    case "ping":
      //var msg = xmppMessage(r[1], 'roombot', stanza_fromJid, "I'm saying pong");
      //xmppSend("bot's sending PONG message", msg);
      botsend(false, 'My answer is pong.');
      break;
    
    case "forceinvite":
      var a = params.split(/ /);
      xmppJoinRoom(r[1], r[2], a[0], a[1], null);
      break;

    case "topic":
      setRoomTopic(r[1], user && user.nick || "roombot", params);
      //var msg = xmppMessage(r[1], 'roombot', stanza_fromJid, "trying to set the topic "+r.join(',')+"...");
      //xmppSend("bot's sending ack message", msg);
      break;
  
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
    
    case "status":case "s":
      if (params) {
        var username = stanza_fromJid.replace(/\/.*$/, "");
        db.mongo.userinfo.update({user:username}, {$set:{statusMessage: params, changed:''+new Date()}}, {upsert:true});
      } else {
        var people = rooms[r[1]].members, ids = {};
        for(var k in people) ids[k.replace(/\/.*$/, "")] = '';
        db.mongo.userinfo.find({user:{$in:Object.keys(ids)}}, function(err,results) {
          for(var k in results) {
            ids[results[k].user] = results[k].statusMessage || '';
          }
          var out=[];
          for(var k in ids) {
            out.push(k+": "+ids[k]);
          }
          botsend(false, out.join('\r\n'));
        });
      }
      break;
    
    case "event":case "remind":case "remember":case "rem":
      var m=params.match(/^(me )?(tomorrow |(in |\+)([0-9]+) d(ays)? |([0-9]{1,2}\.[0-9]{1,2}) )?([0-9]{1,2}):([0-9]{1,2}) (.*)$/);
      if (!m) { botsend(false, 'I didn\'t understand your date format...\r\n  .remember [me] [tomorrow|in <n> days|<dd>.<mm>.] <hh>:<mm> <note to display>'); return; }
      
      var then = moment().startOf('day');
      if (m[2] == "tomorrow") then=then.add('days', 1);
      if (m[4]) then=then.add('days', m[4]);
      if (m[6]) then=moment(m[6], 'DD.MM');
      then=then.hours(m[7]).minutes(m[8]);
      
      var diff = then.valueOf() - new Date().getTime();
      if (diff < 1) { botsend(false, 'Sorry, you already missed that event...'); return; }
      botsend(false,'I took a note to remember you in '+diff+' milliseconds');// '+ then.format('LLLL'));
      
      
      broadcastFlag = !m[1];
      
      setTimeout(function() {
        botsend(false, m[9]);
      }, diff);
      break;
    
    case "help": case "hilfe":
      botsend(false,
                  'I listen to .command and #command. #commands are answered in private, .commands publicly. '+
              '\r\nThese are words I understand:'+
              '\r\n  .ping'+
              '\r\n  .time'+
              '\r\n  .spruch'+
              '\r\n  .topic <new room subject>'+
              '\r\n  .status <your new status>'+
              '\r\n  .status'+
              '\r\n  .remind [me] [tomorrow|in <n> days|<dd>.<mm>.] <hh>:<mm> <note to display>'+
              '\r\n  .s, .rem are valid abbreviations'+
	      '\r\n  .fullhistory <number of stanzas>');
      break;
    
    case "fullhistory":
      broadcastFlag = false;
      if (parseInt(params,10)<=1) { botsend(false, 'Please tell me the number of stanzas you want.'); break; }
      xmppSendHistory(r[1], stanza_fromJid, {attrs: {maxstanzas: params }} );
      break;
    
    default:
      botsend(false, "I don't know about "+cmd+"...");
      break;
    
  }
  
})
