# gcp-node-bot

## Overview
The GCP Node Bot is a bot that is build to automate some of the deployment and monitoring capability in the Google Cloud Platform

It has all the components to make it ready-made to run on Beep Boop.

Visit [Beep Boop](https://beepboophq.com/docs/article/overview) to get the scoop on the the Beep Boop hosting platform. The Slack API documentation can be found [here](https://api.slack.com/).

## Usage

### Run locally
	npm install
	SLACK_TOKEN=<YOUR_SLACK_TOKEN> GOOGLE_CLIENT_ID=<YOUR_GOOGLE_CLOUD_SERVICE_OAUTH_CLIENT_ID> GOOGLE_CLIENT_SECRET=<YOUR_GOOGLE_CLOUD_OAUTH_CLIENT_SECRET> npm start

Things are looking good if the console prints something like:

    ** API CALL: https://slack.com/api/rtm.start
    ** BOT ID:  gcpdev  ...attempting to connect to RTM!

### Run locally in Docker
	docker build -t starter-node .`
	docker run --rm -it -e SLACK_TOKEN=<YOUR SLACK API TOKEN> GOOGLE_CLIENT_ID=<YOUR_GOOGLE_CLOUD_SERVICE_OAUTH_CLIENT_ID> GOOGLE_CLIENT_SECRET=<YOUR_GOOGLE_CLOUD_OAUTH_CLIENT_SECRET> starter-node

### Run in BeepBoop
If you have linked your local repo with the Beep Boop service (check [here](https://beepboophq.com/0_o/my-projects)), changes pushed to the remote master branch will automatically deploy.

### It's Running - Now What?

`gcpbot help` will show a list of available commands

The `deploy new` command relies on a publicly visible repo that has a valid yaml deployment file.  This is just a POC, and we'd probably want to use a remote template with command-line parameters supplied by the deployer.

### Environment Variables

GCPBot can be configured with a few different environment variables:

	GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET - Your Google API credentials. Used to connect to Google APIs and get Oauth tokens for users. See (the Google API Manager)[https://console.developers.google.com/apis/credentials].

	SLACK_TOKEN - provide this to connect to a single app. (Required if you are not connecting to BeepBoop)
	BEEPBOOP_ID, BEEPBOOP_RESOURCER & BEEPBOOP_TOKEN - When these are provided they are used connect to the BeepBoop resourcer. See the [BeepBoop docs](https://beepboophq.com/docs/article/resourcer-api) for details.
	
	FIREBASE_URI, FIREBASE_SECRET - Specify a Firebase DB to save all user data. 

## Acknowledgements

This code uses the [botkit](https://github.com/howdyai/botkit) npm module by the fine folks at Howdy.ai.

## License

See the [LICENSE](LICENSE.md) file (MIT).

