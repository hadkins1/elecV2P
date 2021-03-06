const cheerio = require('cheerio')

const { CONFIG } = require('../config')
const { logger, errStack, sType, sString, sJson, feedPush, iftttPush, store, eAxios, jsfile, file, downloadfile } = require('../utils')
const clog = new logger({ head: 'context', level: 'debug' })

const exec = require('../func/exec')

const formReq = {
  headers(req) {
    const newheaders = req.headers ? sJson(req.headers, true) : {}
    delete newheaders['Content-Length']
    return newheaders
  },
  body(req) {
    if (sType(req) === 'string' || (req.method && req.method.toLowerCase() === 'get')) return null
    const reqb = req.data || req.body
    if (reqb) {
      if (sType(reqb === 'string') && req.headers && /json/i.test(req.headers["Content-Type"])) {
        return sJson(reqb, true)
      }
      return reqb
    } 
    return null
  },
  uest(req, method) {
    const freq = {
      url: req.url || req,
      headers: this.headers(req),
      method: req.method || method || 'get'
    }
    if (!freq.headers['Content-Type'] && !freq.headers['content-type']) freq.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    if (freq.method.toLowerCase() !== 'get') {
      freq.data = this.body(req)
    }
    return freq
  }
}

class contextBase {
  constructor({ fconsole = clog }){
    this.console = fconsole
  }

  __dirname = process.cwd()
  __home = CONFIG.homepage
  __efss = file.get(CONFIG.efss, 'path')
  $axios = eAxios
  $exec = exec
  $cheerio = cheerio
  $download = downloadfile
  $store = store
  $feed = {
    push(title, description, url) {
      feedPush(title, description, url)
    },
    ifttt(title, description, url) {
      iftttPush(title, description, url)
    }
  }
  $done = (data) => {
    this.console.debug('$done:', data)
    this.$result = data !== undefined ? sType(data) === 'object' ? data : { body: data } : {}
    return this.$result
  }
}

class surgeContext {
  constructor({ fconsole = clog }){
    this.fconsole = fconsole
  }

  surgeRequest(req, cb) {
    let error = null,
        resps = {},
        sbody  = ''
    eAxios(formReq.uest(req)).then(response=>{
      resps = {
        status: response.status,
        headers: response.headers,
      }
      sbody = sString(response.data)
    }).catch(err=>{
      this.fconsole.error('$httpClient', req.method, req, err.message)
      if (err.response) {
        error = err.message
        resps = {
          status: err.response.status,
          headers: err.response.headers,
        }
        sbody = sString(err.response.data)
      } else if (err.request) {
        error = 'request config error'
        sbody = sString(req)
      } else {
        error = err.message
        sbody = errStack(err)
      }
    }).finally(()=>{
      if(cb && sType(cb) === 'function') {
        try {
          cb(error, resps, sbody)
        } catch(err) {
          this.fconsole.error('$httpClient', req.method, 'cb error:', errStack(err, true))
        }
      }
    })
  }

  $httpClient = {
    get: (req, cb) => {
      this.surgeRequest(req, cb)
    },
    post: (req, cb) => {
      if (sType(req) === 'string') req = { url: req }
      req.method = 'post'
      this.surgeRequest(req, cb)
    },
    put: (req, cb) => {
      if (sType(req) === 'string') req = { url: req }
      req.method = 'put'
      this.surgeRequest(req, cb)
    },
    delete: (req, cb) => {
      if (sType(req) === 'string') req = { url: req }
      req.method = 'delete'
      this.surgeRequest(req, cb)
    }
  }
  $persistentStore = {
    read(key) {
      return store.get(key)
    },
    write(value, key){
      return store.put(value, key)
    }
  }
  $notification = {
    post: (...data) => {
      this.fconsole.notify(data.map(arg=>sString(arg)).join(' '))
      iftttPush(data[0] + ' ' + data[1], data[2], data[3] ? data[3].url || data[3] : undefined)
    }
  }
}

class quanxContext {
  constructor({ fconsole = clog }){
    this.fconsole = fconsole
  }

  $task = {
    fetch: (req, cb) => {
      let resp = null
      return new Promise((resolve, reject) => {
        eAxios(formReq.uest(req)).then(response=>{
          resp = {
                statusCode: response.status,
                headers: response.headers,
                body: sString(response.data)
              }
          resolve(resp)
        }).catch(error=>{
          this.fconsole.error('$task.fetch', req, error.stack)
          resp = errStack(error)
          reject({ error: resp })
        }).finally(()=>{
          if(cb && sType(cb) === 'function') {
            try {
              cb(resp)
            } catch(err) {
              this.fconsole.error('$task.fetch cb error:', errStack(err, true))
            }
          }
        })
      })
    }
  }
  $prefs = {
    valueForKey(key) {
      return store.get(key)
    },
    setValueForKey(value, key) {
      return store.put(value, key)
    }
  }
  $notify = (...data)=>{
    this.fconsole.notify(data.map(arg=>sString(arg)).join(' '))
    iftttPush(data[0] + ' ' + data[1], data[2], data[3] ? data[3]["open-url"] || data[3]["media-url"] || data[3] : undefined)
  }
}

class context {
  constructor({ fconsole = clog }){
    this.final = new contextBase({ fconsole })
  }

  add({ surge, quanx, addContext, $require }){
    if (surge) {
      this.final.console.debug('启用 surge 兼容模式')
      Object.assign(this.final, new surgeContext({ fconsole: this.final.console }))
    } else if (quanx) {
      this.final.console.debug('启用 quanx 兼容模式')
      Object.assign(this.final, new quanxContext({ fconsole: this.final.console }))
    }
    if ($require) {
      this.final.console.debug('require module', $require)
      if (/^\.\//.test($require)) {
        this.final[$require.split('/').pop().replace(/\.js$/, '')] = require(jsfile.get($require, 'path'))
      } else {
        this.final[$require] = require($require)
      }
    }
    if (addContext) {
      Object.assign(this.final, addContext)
    }
  }
}

module.exports = { context }