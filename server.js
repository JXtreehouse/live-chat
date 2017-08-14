var express = require('express'),
  cookie = require('cookie-parser'),
  app = express(),
  http = require('http').Server(app),
  io = require('socket.io')(http),
  redis = require("redis"),
  redisClient = redis.createClient('6333', '47.94.2.0')

process.on('uncaughtException', function (err) {
  console.error('An uncaught error occurred!');
  console.error(err.stack);
});

redisClient.on("error", function (err) {
  console.log("Error " + err);
});

app.use(cookie())
app.use('/static', express.static(__dirname + '/dist/static'))

app.get('/', function (req, res) {
  res.sendFile(__dirname + '/dist/index.html');
});

var dataSource = {},
  loginNameMapSocket = {}, //上线注册列表
  nameMapName = {}, //服务端记录用户映射，可应对权群聊
  registerCode = 'xjbmy' //注册秘钥

var response = {
  ok: function (data) {
    this.code = 1
    this.rData = data
    return this
  },
  fail: function (msg) {
    this.code = 0
    this.rMsg = msg
    return this
  }
}

io.on('connection', function (socket) {
  socket.on('register', function (param) {
    if (param.registerCode !== 'xjbmy') {
      return void socket.emit('register', response.fail('验证秘钥失败'))
    }
    redisClient.hgetall(param.loginName, function (err, userInfo) {
      if (err) throw(err)
      if (userInfo) {
        return void socket.emit('register', response.fail('用户名已被注册'))
      }

      param.createTime = new Date()
      param.img = '/static/images/2.png' //默认头像
      redisClient.hmset(param.loginName, param)//注册入库
      redisClient.sadd('room', param.loginName)
      loginNameMapSocket[param.loginName] = socket

      socket.emit('register', response.ok({
        user: {
          loginName: param.loginName,
          password: param.password,//todo加密
          name: param.loginName,
          img: param.img
        },
        sessions: userInfo.sessions || []
      }))
      redisClient.smembers('room', function (error, loginNames) {
        if (error) throw error
        io.emit('getUserList', loginNames)
      })
    })
  })

  socket.on('login', function (param) {
    //获取用户信息,聊天记录
    redisClient.hgetall(param.loginName, function (err, userInfo) {
      if (err) throw(err)
      if (!userInfo || userInfo.password !== param.password) {
        return void socket.emit('login', response.fail('用户名密码错误'))
      }

      redisClient.smembers('room', function (error, loginNames) {
        if (error) throw error
        if (-1 !== loginNames.indexOf(param.loginName)) {
          return void socket.emit('login', response.fail('你的账号在别处被登录了'))//别处登录了
        } else {
          redisClient.sadd('room', param.loginName)
          redisClient.hmset(param.loginName, 'createTime', new Date())//更新登录时间
          loginNameMapSocket[param.loginName] = socket
          socket.emit('login', response.ok({
            user: {
              loginName: userInfo.loginName,
              password: userInfo.password,//todo加密
              name: userInfo.nickName || userInfo.loginName,
              img: userInfo.img
            },
            sessions: userInfo.sessions
              ? JSON.parse(userInfo.sessions)
              : []
          }))
          loginNames.push(param.loginName)
          io.emit('getUserList', loginNames)
        }
      })
    })
  })

  socket.on('sendMsg', function (param) {

    var sessions,
      messages,
      session,
      now = new Date()

    redisClient.hgetall(param.from, function (error, userInfo) {
      if (error) throw error
      var sessions = userInfo.sessions
      if(!sessions){
        sessions = []
      }else {
        sessions = JSON.parse(sessions)
      }

      var toSession
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i] && sessions[i].loginName === param.to) {
          toSession = sessions[i]
        }
      }

      if(!toSession) {
        toSession = {}
        toSession.loginName = param.to
        toSession.img = userInfo.img
        toSession.messages = []
        sessions.push(toSession)
      }

      toSession.messages.push(  {
        from: param.from,
        to: param.to,
        content: param.content,
        date: now,
        self: true
      })

      param.img = userInfo.img
      loginNameMapSocket[param.from].emit('sendMsg', param)
      redisClient.hmset(param.from, 'sessions', JSON.stringify(sessions))
    })

    redisClient.hgetall(param.to, function (error, userInfo) {
      if (error) throw error
      var sessions = userInfo.sessions
      if(!sessions){
        sessions = []
      }else {
        sessions = JSON.parse(sessions)
      }

      var fromSession
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i] && sessions[i].loginName === param.from) {
          fromSession = sessions[i]
        }
      }

      if(!fromSession) {
        fromSession = {}
        fromSession.loginName = param.to
        fromSession.img = userInfo.img
        fromSession.messages = []
        sessions.push(fromSession)
      }

      fromSession.messages.push(  {
        from: param.from,
        to: param.to,
        content: param.content,
        date: now,
        self: false
      })
      param.img = userInfo.img
      loginNameMapSocket[param.to].emit('sendMsg', param)
      redisClient.hmset(param.from, 'sessions', JSON.stringify(sessions))
    })

    console.log('from ' + param.from + ',to ' + param.to + ' content:' + param.content)
  })

  socket.on('getUserList', function (loginName) {
    redisClient.smembers('room', function (error, loginNames) {
      if (error) throw error
      var socket = loginNameMapSocket[loginName]
      socket.emit('getUserList', loginNames)
    })
  })

  socket.on('disconnect', function () {
    var disconnected = false
    for (var loginName in loginNameMapSocket) {
      if (loginNameMapSocket[loginName].id === socket.id) {
        delete loginNameMapSocket[loginName]
        disconnected = true
        redisClient.srem('room', loginName)
        io.emit('disconnect', loginName)
        console.log(loginName + " disconnected")
      }
    }
    if (!disconnected) {
      console.log("disconnect cant find socketId")
    }
  })
})

http.listen(8080, function () {
  console.log('listening on *:8080');
});
