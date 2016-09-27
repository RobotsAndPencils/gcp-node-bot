'use strict'

const test = require('ava').test
const sinon = require('sinon')
const Slapp = require('slapp')
const Message = require('slapp/src/message')

// Test context fn
function context (req, res, next) {
  next()
}

test('help', t => {
  t.plan(1)
  let to = setTimeout(() => { t.end() }, 500)
  const slapp = new Slapp({ context })
  require('../flows/help')(slapp)
  let text = 'GCP bot help goes here'
  let msg = new Message('event', { event: {text, type: 'message'} }, { app_token: 'app_token', team_id: 'team_id', channel_id: 'DXXXXX' })
  sinon.stub(msg, 'say', (payload) => {
    t.is(text, payload)
    clearTimeout(to)
  })
  slapp.receiver.emit('message', msg)
})
