var mysql = require('mysql');

var ex = {
    SQL_GET_ALL_USERLINKS :
        "SELECT l.status,u.username,u.fullname,u.isteam FROM twiki_userlink l INNER JOIN twiki_users u ON ((l.user_a=u.username AND user_b = ? )  OR ( user_a = ?  AND  l.user_b=u.username) ) WHERE u.isteam = 0;"
    ,
    SQL_GET_USER_INFO :
        "SELECT id,username,fullname,password FROM  twiki_users  WHERE username = ? AND isteam = 0;"

    };

var mysqlParams = require('./config');
ex.connection = mysql.createConnection(mysqlParams);

//connection.connect();
function handleDisconnect(connection) {
  connection.on('error', function(err) {
    if (!err.fatal) {
      return;
    }
    console.log("Conn lost: "+err.code);
    //if (err.code !== 'PROTOCOL_CONNECTION_LOST') {
    //  throw err;
    //}
    
    console.log('Going to re-connect lost connection in 0.9 sec: ' + err.stack);
    setTimeout(function() {
      console.log("Now reconnecting...");
      ex.connection = mysql.createConnection(mysqlParams);
      handleDisconnect(ex.connection);
      ex.connection.connect();
    }, 900);
  });
}

handleDisconnect(ex.connection);

var databaseUrl = "chatdb"; // "username:password@example.com/mydb"
var collections = ["messages", "globalProperties", "gcmRegistrations"]
ex.mongo = require("mongojs").connect(databaseUrl, collections);

module.exports = ex;
