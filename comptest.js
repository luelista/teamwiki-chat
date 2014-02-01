
var db = require ('./dbconnect.js');
var xmpp = require('node-xmpp');

var myJid = "chat.teamwiki.de";

var component = new xmpp.Component({
    jid: myJid,
    password: "u09qtv4i9u8v3049",
    host: "127.0.0.1",
    port: Number("5347"),
    reconnect: true
})

component.on('online', function() {

    console.log('Component is online')

    component.on('stanza', function(stanza) {
        console.log('Received stanza: ', stanza.toString());
        if (stanza.is('iq')) {
            var recp = stanza.attrs.to.split(/@/);
            if (recp.length == 1 && recp[0] == myJid) {
                if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#info")) {
                    var disco = discoReply(stanza, query), d = disco.getChild('query');
                    d.c('identity', { category: 'conference', type: 'text', name: 'TeamWiki Chat System' });
                    d.c('feature', { 'var': 'http://jabber.org/protocol/muc' });
                    component.send(disco);
                    console.log("sent info stanza : ", disco);
                }
                if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#items")) {
                    var disco = discoReply(stanza, query), d = disco.getChild('query');
                    d.c('item', { jid: 'chat@'+myJid, name: 'The Chat' });
                    //d.c('item', { 'var': 'http://jabber.org/protocol/muc' });
                    component.send(disco);
                    console.log("sent items stanza : ", disco);
                }
            }
            if (recp.length == 2 && recp[1] == myJid && recp[0] == "chat") {
                if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#info")) {
                    var disco = discoReply(stanza, query), d = disco.getChild('query');
                    d.c('identity', { category: 'conference', type: 'text', name: 'The Chat' });
                    d.c('feature', { 'var': 'muc_open' });
                    d.c('feature', { 'var': 'muc_permanent' });
                    d.c('feature', { 'var': 'muc_public' });
                    component.send(disco);
                    console.log("sent info stanza : ", disco);
                }
                if (query = stanza.getChild('query', "http://jabber.org/protocol/disco#items")) {
                    var disco = discoReply(stanza, query), d = disco.getChild('query');
                    component.send(disco);
                    console.log("sent items stanza : ", disco);
                }
            }
        }
        /*if (stanza.is('message')) {
            var i = parseInt(stanza.getChildText('body'))
            var reply = new ltx.Element('message', { to: stanza.attrs.from, from: stanza.attrs.to, type: 'chat' })
            reply.c('body').t(isNaN(i) ? 'i can count!' : ('' + (i + 1)))
            component.send(reply)
        }*/
    })

    // nodejs has nothing left to do and will exit
    //component.end()
})

function discoReply(stanza, query) {
    var disco = new xmpp.Element('iq', 
        { type: 'result', from: myJid, to: stanza.attrs.from, id: stanza.attrs.id });
    disco.c('query', { xmlns: query.attrs.xmlns });
    return disco;
}

component.on('offline', function () {
    console.log('Component is offline')
})


component.on('connect', function () {
    console.log('Component is connected')
})

component.on('reconnect', function () {
    console.log('Component reconnects …')
})

component.on('disconnect', function (e) {
    console.log('Component is disconnected', e)
})

component.on('error', function(e) {
    console.error(e)
    process.exit(1)
})

process.on('SIGINT', function() {
    console.log("Sigint, disconnecting ...");
    component.end();
    process.exit(0);
});

process.on('exit', function () {
    console.log("Disconnecting ...");
    component.end();
})


