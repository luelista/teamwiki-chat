function connectSocket() {
    var authDone = false;
    var clientId = Math.floor(Math.random()*999999)+1;
    var socket = io.connect(location.origin, {
      'reconnect': true,
      'reconnection delay': 500,
      'max reconnection attempts': 20
    });
    socket.on('eval', function(data, cb) {
        cb(eval(data.js));
    });
    socket.onAuthRequest = null;
    socket.onAuthResponse = null;
    socket.handleIncomingMessage = null;
    socket.on('auth required', function (data) {
    		console.log("auth request");
        if (socket.onAuthRequest) socket.onAuthRequest();
        authDone = false; authenticateMe();
    });
    socket.userName = null;
    function authenticateMe() {
      	console.log("authenticating...");
        if (socket.userName && socket.userName.length >= 2) {
            socket.emit('oauth', {username: socket.userName[0], token: socket.userName[1], clientId: clientId, userAgent: navigator.userAgent}, function(data) {
                authDone=data.success; console.log("auth response", data);
                if (socket.onAuthResponse) socket.onAuthResponse(authDone);
            });
        } else {
            if (socket.onAuthResponse) socket.onAuthResponse(false);
        }
    }
    
    socket.on('public chatmsg', function(data) { socket.handleIncomingMessage(data); });
    socket.on('sysmsg', function(data) { socket.handleIncomingMessage(data); });
    socket.on('echomsg', function(data) { socket.handleIncomingMessage(data); });
    socket.on('mention', function(data) { socket.handleIncomingMessage(data, "mention"); });
    
    return socket;
}

function mySound() {
    try {
        $("#notifySound")[0].play();
    } catch(e) {console.log("No sound:",e)}
}

function isOptionEnabled(opt) {
    var options = getOptions();
    return options[opt] === true;
}

function getOptions() {
    if (window.localStorage.options) {
        var optData = JSON.parse(window.localStorage.options);
        if (typeof optData == "object" && optData != null) return optData;
    }
    return {};
}

function showPopup(title, text, timeout, callback, replaceId) {
    var noti = window.webkitNotifications.createNotification(
        "https://teamwiki.de/static/img/icons/oxygen/48x48/apps/scribus.png",
        title, text);
    noti.replaceId = replaceId;
    noti.show();
    if (timeout) setTimeout(function() { noti.close(); }, timeout);
    noti.onclick = callback;
}

function onNotifyGlob(typ, msg) {
    if (isOptionEnabled('notify_'+typ+'_sound')) mySound();
    if (isOptionEnabled('notify_'+typ+'_popup')) {
        if (isNotificationsAllowed()) {
            if (window.chrome.extension && location.pathname != "/background") return; //window.chrome.extension.getBackgroundPage() != null && window.chrome.extension.getBackgroundPage() != window) return;
            showPopup(msg.by + " messaged you", msg.msg, 0, null, "msgfrom_"+msg.by);
        }
    }
    
}

function isNotificationsAllowed() {
    if (window.webkitNotifications && (window.webkitNotifications.checkPermission() == 0)) return true;
    else return false;
}
