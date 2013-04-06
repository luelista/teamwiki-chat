var xmpp = require("node-xmpp");
var rout = new xmpp.Router();
rout.register("teamwiki.de", function(stanza) {
  var body = stanza.getChild('body');
  console.log("listener called", stanza.attrs.from, stanza.attrs.type);
  if (body) console.log("Msg: ", body.getText());
});

rout.send(new xmpp.Element('message', { from: 'test@teamwiki.de', to: 'max.weller@jabber.org' }).c('body').t('meine Nachricht'));
console.log("sent??");


