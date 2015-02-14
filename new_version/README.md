


Roombot commands
----------------

Every room has a occupant named roombot, which is used to control the chatroom properties and can do additional services.

This is the current list of supported commands:

| Command | Parameters | Description |
|---------|------------|-------------|
| prop    | (none)     | Print all chatroom properties <br> Example: /prop |
| prop    | <name>     | Print the value of the chatroom property [name] <br> Example: /prop acl |
| prop    | <name>=<value> | Set the value of the chatroom property [name] to [value] <br> Example: /prop web-archive-password=123456 |
| who     | (none)     | List all occupants of the chatroom and their JIDs |
| ping    | (none)     | Print some example text |
| time    | (none)     | Print the current time |
| topic   | [new topic] | Change the topic of the current room <br> Example: /topic This is the sample chatroom 42 |
| hist    | [number]   | Print the [number] last messages sent in this room. If [number] is omitted, 5 will be used. <br> Example: /hist 15 |

This list is incomplete, please see bot.js for all commands.



