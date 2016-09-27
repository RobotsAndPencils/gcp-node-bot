'use strict'

module.exports = (slapp) => {
  const help = 'GCP bot help goes here'

  slapp.message('help', ['direct_mention', 'direct_message'], (msg, text) => {
    msg.say(help)
  })
}
