const dgram = require('dgram');
const net = require('net');
const path = require('path');
const { udpLookup, tcpLookup } = require('./common/request');
const { udpPacketToTcpPacket, tcpPacketToUdpPacket } = require('./common/convert');
const { parseTCPPacket, parseUDPPacket } = require('./common/packet-parser');
const { isIPv6 } = require('./common/utils');
const loadConfig = require('./common/load-config');
const RuleParser = require('./common/rule-parser');
const { DNSTYPE } = require('./common/consts');

const setupUDPServer = (host, port, rules) => {
	const udpServer = dgram.createSocket(isIPv6(host) ? 'udp6' : 'udp4');

	udpServer.on('error', err => {
		console.log('[UDP] Server Error');
		console.log(err);
	});

	udpServer.on('message', (msg, rinfo) => {
		const lookup = {
			tcp: (msg, server) => {
				msg = udpPacketToTcpPacket(msg);
				tcpLookup(msg, server.port, server.host).then(data => {
					data = tcpPacketToUdpPacket(data);
					udpServer.send(data, rinfo.port, rinfo.address, err => {
						if (err) {
							console.log('[UDP] (TCP) Response Data Error');
							console.log(err);
						}
					});
				}).catch(err => {
					console.log('[UDP] (TCP) Request Data Error');
					console.log(err);
				});
			},
			udp: (msg, server) => {
				udpLookup(msg, server.port, server.host).then(data => {
					udpServer.send(data, rinfo.port, rinfo.address, err => {
						if (err) {
							console.log('[UDP] (UDP) Response Data Error');
							console.log(err);
						}
					});
				}).catch(err => {
					console.log('[UDP] (UDP) Request Data Error');
					console.log(err);
				});
			}
		};

		const packet = parseUDPPacket(msg);
		// we can only resolve the first question,
		// thought most of requests has only one question
		const resolve = rules.resolve(packet.Question[0].Name);
		const { server, index } = resolve;
		packet.Question.forEach(question => {
			console.log(`[UDP] Query [${question.Name}](${DNSTYPE[question.Type]}) --> ${server.host}:${server.port}@${server.type} ${index < 0 ? '' : `(#${index + 1})`}`);
		});
		lookup[server.type](msg, server);
	});

	udpServer.on('listening', () => {
		let { address, port } = udpServer.address();
		if (address.indexOf(':') >= 0) {
			address = `[${address}]`;
		}
		console.log(`[UDP] server listening ${address}:${port}`);
	});

	udpServer.bind(port, host);
	return udpServer;
};

const setupTCPServer = (host, port, rules) => {
	const tcpServer = net.createServer();

	tcpServer.on('error', err => {
		console.log('[TCP] Server Error');
		console.log(err);
	});

	tcpServer.on('connection', socket => {
		let length = 0;
		let received = Buffer.alloc(0);

		const lookup = {
			tcp: (msg, server) => {
				tcpLookup(msg, server.port, server.host).then(data => {
					socket.write(data, err => {
						if (err) {
							console.log('[TCP] (TCP) Response Data Error');
							console.log(err);
						}
						socket.end();
					});
				}).catch(err => {
					console.log('[TCP] (TCP) Request Data Error');
					console.log(err);
					socket.end();
				});
			},
			udp: (msg, server) => {
				msg = tcpPacketToUdpPacket(msg);
				udpLookup(msg, server.port, server.host).then(data => {
					data = udpPacketToTcpPacket(data);
					socket.write(data, err => {
						if (err) {
							console.log('[TCP] (UDP) Response Data Error');
							console.log(err);
						}
						socket.end();
					});
				}).catch(err => {
					console.log('[TCP] (UDP) Request Data Error');
					console.log(err);
					socket.end();
				});
			}
		};

		socket.on('data', msg => {
			if (length === 0) {
				length = (msg[0] << 8) + msg[1];
			}
			received = Buffer.concat([received, msg]);
			msg = null;

			if (length + 2 === received.byteLength) {
				const packet = parseTCPPacket(received);
				// we can only resolve the first question,
				// thought most of requests has only one question
				const resolve = rules.resolve(packet.Question[0].Name);
				const { server, index } = resolve;
				packet.Question.forEach(question => {
					console.log(`[TCP] Query [${question.Name}](${DNSTYPE[question.Type]}) --> ${server.host}:${server.port}@${server.type} ${index < 0 ? '' : `(#${index + 1})`}`);
				});
				lookup[server.type](received, server);
			}
		});
		socket.on('error', (err) => {
			console.log('[TCP] Connection Error');
			console.log(err.stack);
			socket.end();
		});
	});

	tcpServer.on('listening', () => {
		let { address, port } = tcpServer.address();
		if (address.indexOf(':') >= 0) {
			address = `[${address}]`;
		}
		console.log(`[TCP] server listening ${address}:${port}`);
	});

	tcpServer.listen(port, host);
	return tcpServer;
};

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

	// if not specify config file, load from environment variable
	if (!input['config-file']) {
		input['config-file'] = process.env.DNSPROXY_CONFIG || path.resolve('./config.json');
	}

	return input;
};

const init = () => {
	const input = loadInput();
	console.log(`Loading config file '${input['config-file']}'...`);
	const config = loadConfig(input['config-file']);

	const { servers } = config;
	const defaultServer = servers.default || servers[Object.keys(servers)[0]];
	const rules = new RuleParser();
	rules.initDefaultServer(defaultServer);
	rules.initParsers(config['extend-parsers']);
	rules.initRules(config.rules);

	let udpServer;
	let tcpServer;
	if (!config.udp.enable && !config.tcp.enable) {
		console.log('Both TCP and UDP servers are not enabled');
		return;
	}
	if (config.udp.enable) {
		const { host, port } = config.udp;
		udpServer = setupUDPServer(host, port, rules);
	}
	if (config.tcp.enable) {
		const { host, port } = config.tcp;
		tcpServer = setupTCPServer(host, port, rules);
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