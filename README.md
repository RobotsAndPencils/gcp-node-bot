# gcp-node-bot

## Overview
The GCP Node Bot is a bot that is build to automate some of the deployment and monitoring capability in the Google Cloud Platform

It has all the components to make it ready-made to run on Beep Boop.

Visit [Beep Boop](https://beepboophq.com/docs/article/overview) to get the scoop on the the Beep Boop hosting platform. The Slack API documentation can be found [here](https://api.slack.com/).

## Usage

### Run locally
	npm install
	SLACK_TOKEN=<YOUR_SLACK_TOKEN> PROJECT_ID=<YOUR_GOOGLE_CLOUD_PROJECT> npm start

Things are looking good if the console prints something like:

    ** API CALL: https://slack.com/api/rtm.start
    ** BOT ID:  witty  ...attempting to connect to RTM!
    ** API CALL: https://slack.com/api/chat.postMessage

### Run locally in Docker
	docker build -t starter-node .`
	docker run --rm -it -e SLACK_TOKEN=<YOUR SLACK API TOKEN> PROJECT_ID=<YOUR_GOOGLE_CLOUD_PROJECT> starter-node

### Run in BeepBoop
If you have linked your local repo with the Beep Boop service (check [here](https://beepboophq.com/0_o/my-projects)), changes pushed to the remote master branch will automatically deploy.

### It's Running - Now What?

`gcpbot help` will show a list of available commands

The `deploy new` command relies on a publicly visible repo that has a valid yaml deployment file.  This is just a POC, and we'd probably want to use a remote template with command-line parameters supplied by the deployer.

## Acknowledgements

This code uses the [botkit](https://github.com/howdyai/botkit) npm module by the fine folks at Howdy.ai.

## License

See the [LICENSE](LICENSE.md) file (MIT).
