// Setup basic express server
var express = require('express');
var app = express();
var path = require('path');
var server = require('http').createServer(app);
const redis = require('redis');
var io = require('socket.io')(server);
var redis_socket = require('socket.io-redis');
const redis_pub_host = process.env.REDIS_ENDPOINT || "redis";
const redis_sub_host = process.env.REDIS_ENDPOINT || "redis";
const redis_port = process.env.REDIS_SERVICE_PORT || 6379;
const redis_pass = process.env.REDIS_SERVICE_PASS || "redis";
const redis_pub = redis.createClient(redis_port, redis_pub_host, { auth_pass: redis_pass });
const redis_sub = redis.createClient(redis_port, redis_sub_host, { auth_pass: redis_pass });
io.adapter(redis_socket({ pubClient: redis_pub, subClient: redis_sub }));

var Presence = require('./lib/presence');

// Lower the heartbeat timeout
io.set('heartbeat timeout', 8000);
io.set('heartbeat interval', 4000);

var port = process.env.PORT || 8080;

server.listen(port, function() {
  console.log('Server listening at port %d', port);
});

// Routing
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', function(socket) {
  var addedUser = false;

  // when the client emits 'new message', this listens and executes
  socket.on('new message', function(data) {
    // we tell the client to execute 'new message'
    socket.broadcast.emit('new message', {
      username: socket.username,
      message: data
    });
  });

  socket.conn.on('heartbeat', function() {
    if (!addedUser) {
      // Don't start upserting until the user has added themselves.
      return;
    }

    Presence.upsert(socket.id, {
      username: socket.username
    });
  });

  // when the client emits 'add user', this listens and executes
  socket.on('add user', function(username) {
    if (addedUser) {
      return;
    }

    // we store the username in the socket session for this client
    socket.username = username;
    Presence.upsert(socket.id, {
      username: socket.username
    });
    addedUser = true;

    Presence.list(function(users) {
      socket.emit('login', {
        numUsers: users.length
      });

      // echo globally (all clients) that a person has connected
      socket.broadcast.emit('user joined', {
        username: socket.username,
        numUsers: users.length
      });
    });
  });

  // when the client emits 'typing', we broadcast it to others
  socket.on('typing', function() {
    socket.broadcast.emit('typing', {
      username: socket.username
    });
  });

  // when the client emits 'stop typing', we broadcast it to others
  socket.on('stop typing', function() {
    socket.broadcast.emit('stop typing', {
      username: socket.username
    });
  });

  // when the user disconnects.. perform this
  socket.on('disconnect', function() {
    if (addedUser) {
      Presence.remove(socket.id);

      Presence.list(function(users) {
        // echo globally (all clients) that a person has connected
        socket.broadcast.emit('user left', {
          username: socket.username,
          numUsers: users.length
        });
      });
    }
  });
});
