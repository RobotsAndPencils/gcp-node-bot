var Botkit = require('botkit')
var jsonfile = require('jsonfile')
var querystring = require('querystring');
var http = require('http');
var request = require('request');
var google = require('googleapis');
var manager = google.deploymentmanager('v2');
var monitoring = google.cloudmonitoring('v2beta2');
var compute = google.compute('v1');

// Expect a SLACK_TOKEN environment variable
var slackToken = process.env.SLACK_TOKEN
if (!slackToken) {
  console.error('SLACK_TOKEN is required!')
  process.exit(1)
}

// id: 1047464413093-1v98trn2qdggn3edu2n6cfo15t8589cn.apps.googleusercontent.com
// secret: ahhGUn-FY75NCdmUdI2FZZJN
var keyfile = 'gcp-bot-test-9c7dbb93f7ba.json';

var gcloud = require('gcloud')({
  projectId: process.env.PROJECT_ID,
  keyFilename: keyfile
});

var key = require("./" + keyfile);
var jwtClient = new google.auth.JWT(key.client_email, null, key.private_key,
  [
    'https://www.googleapis.com/auth/ndev.cloudman',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/monitoring',
  ], null);

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

controller.hears(['gcpbot deploy detail (.*)'], ['message_received','ambient'], function (bot, message) {

  var depId = message.match[1].trim();

  jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }

    bot.reply(message, "Deployment detail for deployment " + depId);

    checkDeploy(bot, message, jwtClient, depId );
  });
});

controller.hears(['gcpbot deploy summary (.*)'], ['message_received','ambient'], function (bot, message) {
  //bot.reply(message, 'Hello.  I will be helping you with that request for gcp projects')

    var user = message.match[1].trim();

    var email = user.substring( user.indexOf(':') + 1, user.indexOf('|'));
    console.log(email);

    jwtClient.authorize(function(err, tokens) {
      if (err) {
        console.log(err);
        return;
      }

      bot.reply(message, "Deployment summary for " + email);

      var filterStr = 'operation.user eq ' + email;

      // Make an authorized request to list Drive files.
      manager.deployments.list({
        auth: jwtClient,
        project: 'gcp-bot-test',
        region: 'us-central1',
        filter: filterStr },
        function(err, resp) {
          if( err) {
            console.log(err);
            return;
          }

          if( !resp.deployments ) {
            bot.reply(message, "no deployments to report on");
            return;
          }

          var deployTotalCount = resp.deployments.length;
          var deployActiveCount = 0;

          var activeDeploys = [];
          var deadDeploys = [];


          for ( i = 0; i < resp.deployments.length; i++ ) {
              if( resp.deployments[i].operation.status != 'DONE' ) {
                deployActiveCount++;
                activeDeploys.push( resp.deployments[i] );
              }
              else {
                deadDeploys.push( resp.deployments[i] );
              }
          }

          bot.reply(message, "deployment total count: " + deployTotalCount);
          bot.reply(message, "deployments active: " + deployActiveCount);

          for ( i = 0; i < activeDeploys.length; i++ ) {
            bot.reply(message, "Deploy " +
              activeDeploys[i].name + " with id " + activeDeploys[i].id + " Active: started at " +
              activeDeploys[i].operation.startTime + " by " +
              activeDeploys[i].operation.user + " ---- deployment is " +
              activeDeploys[i].operation.progress + " percent complete. To view progress, navigate to " +
              " https://console.cloud.google.com/deployments?authuser=1&project=" + process.env.PROJECT_ID );
          }

          for ( i = 0; i < deadDeploys.length; i++ ) {
            bot.reply(message, "Deploy " +
              deadDeploys[i].name + " with id " + deadDeploys[i].id + " COMPLETE: started at " +
              deadDeploys[i].operation.startTime + " by " +
              deadDeploys[i].operation.user + " ---- deployment completed at " +
              deadDeploys[i].operation.endTime );
          }
        });
    });
})

// DEPLOYMENT of a file from github
controller.hears(['gcpbot deploy new (.*) (.*)'], ['message_received','ambient'], function (bot, message) {

  var ghPref = 'https://github.com/';
  var rawMaster = '/raw/master/';

  //parse the stuff from inbound
  var repo = message.match[1].trim();
  var yaml = message.match[2].trim();

  var fullPath = ghPref + repo + rawMaster + yaml + ".yaml";

  //get the file, use it as the resource info supplied to the insert cmd in gcp
  var resContent = "";

  request(fullPath, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      resContent = body;

      //now print content
      console.log("content found: " + resContent);

      //now do the auth and call to manifest
      jwtClient.authorize(function(err, tokens) {
        if (err) {
          console.log(err);
          return;
        }

        var depName = yaml + Math.floor(new Date() / 1000);

        manager.deployments.insert({
          auth: jwtClient,
          project: 'gcp-bot-test',
          resource: {
            name: depName,
            target: {
              config: {
                content: resContent
              }
            }
          }
         },
          function( err, resp ) {

            if( err ) {
              console.log(err);
              return;
            }

            var complete = false;

            checkDeploy(bot, message, jwtClient, depName );
          }
        );
      });
    }
  })
})

function checkDeploy( bot, message, jwtClient, depName ) {

  var status = "";
  var filterStr = 'name eq ' + depName;

  return manager.deployments.list({
    auth: jwtClient,
    project: 'gcp-bot-test',
    region: 'us-central1',
    filter: filterStr },
    function(err, resp) {
      if( err) {
        console.log(err);
        return;
      }

      if( !resp.deployments ) {
        bot.reply(message, "no deployment found");
        return;
      }

      var currDeploy = resp.deployments[0];

      bot.reply(message, "Deploy " +
        currDeploy.name + " status = " + currDeploy.operation.status + " : started at " +
        currDeploy.operation.startTime + " by " +
        currDeploy.operation.user + " ---- deployment completed at " +
        currDeploy.operation.endTime );

      if( currDeploy.operation.status != "DONE" && currDeploy.operation.status != "COMPLETE" ) {
        bot.reply(message, "Current progress: " + currDeploy.operation.progress);

        //sorry for the horrible hack here
        sleep( 2000 );

        checkDeploy( bot, message, jwtClient, depName );
      }
      else {
        return;
      }
    });
}

//nothing to see here...
function sleep(miliseconds) {
   var currentTime = new Date().getTime();

   while (currentTime + miliseconds >= new Date().getTime()) {
   }
}

controller.hears('gcpbot help', ['message_received', 'ambient'], function (bot, message) {
  var help = 'I will respond to the following messages: \n' +
      '`gcpbot deploy summary` for a list of all deployment manager jobs and their status.\n' +
      '`gcpbot deploy new <repo> <depfile>` to create a new deployment using a yaml file in the github repo identified with a yaml file called <depfile>.yaml.\n' +
      '`gcpbot deploy detail <depname>` to show info and status for a given deployment manager job.\n' +
      '`gcpbot help` to see this again.'
  bot.reply(message, help)
})


controller.hears(['gcpbot monitor', 'gcpbot m'], ['message_received','ambient'], function (bot, message) {

  jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }

    monitoring.metricDescriptors.list({
      auth: jwtClient,
      project: 'gcp-bot-test',
      count: 100 },
      //metric: 'compute.googleapis.com/instance/uptime',
      //youngest: new Date().toJSON()},
      function( err, resp ) {

        if( err ) {
          console.log(err);
          return;
        }

        //console.log( "resp: " + JSON.stringify(resp) );

        metrics = resp.metrics;

        console.log("metrics: " + metrics.length);

        for( i = 0; i < metrics.length; i++ ) {
          //console.log(metrics[i].name + " desc: " + metrics[i].description );
        }

      }
    );

    //compute.googleapis.com/instance/cpu/utilization
  });

  jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }

    compute.instances.list({
      auth: jwtClient,
      project: 'gcp-bot-test',
      zone: 'us-central1-a'},
      function( err, resp ) {

        if( err ) {
          console.log(err);
          return;
        }

        console.log( "resp: " + JSON.stringify(resp) );
      }
    );
  });

});
