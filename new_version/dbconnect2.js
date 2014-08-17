
module.exports = function(config) {
    
    var ex = {
        };
    
    var databaseUrl = config.dbName; // "username:password@example.com/mydb"
    var collections = ["rooms", "messages", "globalProperties", "userinfo", "gcmRegistrations"]
    ex.mongo = require("mongojs").connect(databaseUrl, collections);
    
    return ex;
    
};
