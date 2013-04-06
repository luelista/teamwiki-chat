var request = require('request');
 
var GCM = function(api_key) {
  this._api_key = api_key;
}
 
GCM.prototype.send = function(msg, callback) {
  console.log("GCM.send", msg);
  request.post({
    uri: 'https://android.googleapis.com/gcm/send',
    json: msg,
    headers: {
      Authorization: 'key=' + this._api_key
    }
  }, function(err, response, body) {
    callback(err, body);
  })
}
 
module.exports = GCM;