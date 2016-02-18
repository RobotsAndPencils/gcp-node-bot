var Botkit = require('botkit')
var jsonfile = require('jsonfile')
var querystring = require('querystring');
var http = require('http');
var request = require('request');

var tokenfile = '/tmp/gcp-token.json'

// Expect a SLACK_TOKEN environment variable
var slackToken = process.env.SLACK_TOKEN
if (!slackToken) {
  console.error('SLACK_TOKEN is required!')
  process.exit(1)
}

// id: 1047464413093-1v98trn2qdggn3edu2n6cfo15t8589cn.apps.googleusercontent.com
// secret: ahhGUn-FY75NCdmUdI2FZZJN


/*
var gcpJson = {
    type: "service_account",
    project_id: process.env.PROJECT_ID,
    private_key_id: process.env.PRIVATE_KEY_ID,
    private_key: process.env.PRIVATE_KEY,
    client_email: process.env.CLIENT_EMAIL,
    client_id: process.env.CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://accounts.google.com/o/oauth2/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/gcp-bot-test%40gcp-bot-test.iam.gserviceaccount.com"
}

jsonfile.writeFile(tokenfile, gcpJson, function (err) {
  console.error(err)
})

var gcloud = require('gcloud')({
  projectId: gcpJson.project_id,
  keyFilename: tokenfile
});
*/

var controller = Botkit.slackbot()
var bot = controller.spawn({
  token: slackToken
})



bot.startRTM(function (err, bot, payload) {
  if (err) {
    throw new Error('Could not connect to Slack')
  }
})

controller.on('bot_channel_join', function (bot, message) {
  bot.reply(message, "I'm here!")
})

controller.hears(['gcpbot projects'], ['message_received','ambient'], function (bot, message) {
  //bot.reply(message, 'Hello.  I will be helping you with that request for gcp projects')

  //first post to oauth to get device code
  // Build the post string from an object
  var post_data = querystring.stringify({
      'client_id': '1047464413093-1v98trn2qdggn3edu2n6cfo15t8589cn.apps.googleusercontent.com'
  });

  request({
    url: 'http://accounts.google.com/o/oauth2/device/code', //URL to hit
    qs: {client_id: '1047464413093-1v98trn2qdggn3edu2n6cfo15t8589cn.apps.googleusercontent.com'}, //Query string data
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(post_data)
    },
    body: JSON.stringify({scope: 'email profile', client_id: '1047464413093-1v98trn2qdggn3edu2n6cfo15t8589cn.apps.googleusercontent.com'}) //Set the body as a string
}, function(error, response, body){
    if(error) {
        console.log(error);
    } else {
        console.log(response.statusCode, body);
    }
});

})

controller.hears(['gcpbot help'], ['message_received','ambient'], function (bot, message) {
  bot.reply(message, 'Here, you will find details on what the gcp bot can do')
})

controller.hears(['hello', 'hi'], ['direct_mention'], function (bot, message) {
  bot.reply(message, 'Hello.')
})

controller.hears(['hello', 'hi'], ['direct_message'], function (bot, message) {
  bot.reply(message, 'Hello.')
  bot.reply(message, 'It\'s nice to talk to you directly.')
})

controller.hears('.*', ['mention'], function (bot, message) {
  bot.reply(message, 'You really do care about me. :heart:')
})

controller.hears('help', ['direct_message', 'direct_mention'], function (bot, message) {
  var help = 'I will respond to the following messages: \n' +
      '`bot hi` for a simple message.\n' +
      '`bot attachment` to see a Slack attachment message.\n' +
      '`@<your bot\'s name>` to demonstrate detecting a mention.\n' +
      '`bot help` to see this again.'
  bot.reply(message, help)
})

controller.hears(['attachment'], ['direct_message', 'direct_mention'], function (bot, message) {
  var text = 'Beep Beep Boop is a ridiculously simple hosting platform for your Slackbots.'
  var attachments = [{
    fallback: text,
    pretext: 'We bring bots to life. :sunglasses: :thumbsup:',
    title: 'Host, deploy and share your bot in seconds.',
    image_url: 'https://storage.googleapis.com/beepboophq/_assets/bot-1.22f6fb.png',
    title_link: 'https://beepboophq.com/',
    text: text,
    color: '#7CD197'
  }]

  bot.reply(message, {
    attachments: attachments
  }, function (err, resp) {
    console.log(err, resp)
  })
})

controller.hears('.*', ['direct_message', 'direct_mention'], function (bot, message) {
  bot.reply(message, 'Sorry <@' + message.user + '>, I don\'t understand. \n')
})
