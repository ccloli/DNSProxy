const path = require('path');
const loadConfig = require('./common/load-config');
const RuleParser = require('./common/rule-parser');
const { setupTCPServer, setupUDPServer } = require('./common/server');

const loadInput = () => {
	const inputShortMap = {
		'c': 'config-file'
	};

	const input = {};
	let lastInput = null;
	for (let arg of process.argv.slice(2)) {
		if (lastInput) {
			input[lastInput] = arg;
			lastInput = null;
		}
		else if (arg.indexOf('--') === 0) {
			lastInput = arg.substr(2);
		}
		else if (arg.indexOf('-') === 0) {
			lastInput = inputShortMap[arg.substr(1)];
		}
	}

	// if no config file specified, load from environment variable
	if (!input['config-file']) {
		input['config-file'] = process.env.DNSPROXY_CONFIG || path.resolve('./config.json');
	}

	return input;
};

const init = () => {
	const input = loadInput();
	console.log(`Loading config file '${input['config-file']}'...`);
	const config = loadConfig(input['config-file']);

	const { servers, settings } = config;
	const defaultServer = servers.default || servers[Object.keys(servers)[0]];
	const rules = new RuleParser();
	rules.initDefaultServer(defaultServer);
	rules.initParsers(config['extend-parsers'], input['config-file']);
	rules.initRules(config.rules, servers, input['config-file']);

	let udpServer;
	let tcpServer;
	if (!settings.udp && !settings.tcp) {
		console.log('Both TCP and UDP servers are not enabled');
		return;
	}
	if (settings.udp) {
		const { host, port, timeout } = settings;
		udpServer = setupUDPServer(host, port, timeout, rules);
	}
	if (settings.tcp) {
		const { host, port, timeout } = settings;
		tcpServer = setupTCPServer(host, port, timeout, rules);
	}

	const closeListener = (data) => {
		const input = data[0];
		switch (input) {
			case 0x03:
			case 0x1a:
				process.exit();
				break;

			case 0x12:
				process.stdin.removeListener('data', closeListener);
				console.log('Closing proxy servers...');
				udpServer && udpServer.close();
				tcpServer && tcpServer.close();
				setTimeout(init, 0);
				break;
		}
	};

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on('data', closeListener);

	console.log('Press ^R to reload, ^C or ^Z to exit');
};

console.log(`DNSProxy v${process.env.npm_package_version || require('./package.json').version}\n`);
init();