const path = require('path');
const fs = require('fs');
const loadConfig = require('./lib/load-config');
const RuleParser = require('./lib/rule-parser');
const { setupTCPServer, setupUDPServer } = require('./lib/server');

const loadInput = () => {
	const inputShortMap = {
		'c': 'config-file',
		'i': 'init',
		'h': 'help'
	};
	const defaultValue = {
		'config-file': './config.json',
		'init': './config.json',
		'help': true
	};

	const input = {};
	let lastInput = null;
	for (let arg of process.argv.slice(2)) {
		if (arg.indexOf('-') === 0) {
			if (arg.indexOf('--') === 0) {
				lastInput = arg.substr(2);
			}
			else {
				lastInput = inputShortMap[arg.substr(1)];
			}
			input[lastInput] = defaultValue[lastInput];
		}
		else if (lastInput) {
			input[lastInput] = arg;
			lastInput = null;
		}
	}

	// if no config file specified, load from environment variable
	if (!input['config-file']) {
		input['config-file'] = process.env.DNSPROXY_CONFIG || path.resolve('./config.json');
	}

	return input;
};

const init = (input) => {
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
		const keyCode = data[0];
		switch (keyCode) {
			case 0x03:
			case 0x1a:
				process.exit();
				break;

			case 0x12:
				process.stdin.removeListener('data', closeListener);
				console.log('Closing proxy servers...');
				udpServer && udpServer.close();
				tcpServer && tcpServer.close();
				setTimeout(init, 0, input);
				break;
		}
	};

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on('data', closeListener);

	console.log('Press ^R to reload, ^C or ^Z to exit');
};

const printHelp = () => {
	console.log(`Usage:
  dnsproxy [options]

Options:
  -c, --config-file <path>   Specify the configuration file
                             (default: env['DNSPROXY_CONFIG'] || ./config.json)
  -i, --init <path>          Create a configuration template file
                             (default: ./config.json)
  -h, --help                 Show help
`);
};

const main = () => {
	const input = loadInput();

	if (input.help) {
		printHelp();
		return;
	}
	if (input.init) {
		const dir = path.resolve(input.init);
		if (fs.existsSync(dir)) {
			console.log(`File ${dir} is already exist.`);
			return;
		}
		const read = fs.createReadStream(path.resolve(__dirname, './config.sample.json'));
		const write = fs.createWriteStream(dir);
		write.on('close', () => {
			console.log(`Config template file ${dir} is created.`);
		});
		read.pipe(write);
		return;
	}

	init(input);
};

console.log(`DNSProxy v${process.env.npm_package_version || require('./package.json').version}\n`);
main();