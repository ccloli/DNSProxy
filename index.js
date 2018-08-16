const dgram = require('dgram');
const net = require('net');
const path = require('path');
const { udpLookup, tcpLookup, tlsLookup } = require('./common/request');
const { udpPacketToTcpPacket, tcpPacketToUdpPacket } = require('./common/convert');
const { parseTCPPacket, parseUDPPacket } = require('./common/packet-parser');
const { isIPv6 } = require('./common/utils');
const loadConfig = require('./common/load-config');
const RuleParser = require('./common/rule-parser');
const { DNSTYPE } = require('./common/consts');

const setupUDPServer = (host, port, timeout, rules) => {
	const udpServer = dgram.createSocket(isIPv6(host) ? 'udp6' : 'udp4');

	udpServer.on('error', err => {
		console.log('[UDP] Server Error');
		console.log(err);
	});

	udpServer.on('message', (msg, rinfo) => {
		const response = (data) => {
			return new Promise((resolve, reject) => {
				udpServer.send(data, rinfo.port, rinfo.address, err => {
					data = null;
					if (err) {
						return reject(err);
					}
					resolve();
				});
			});
		};
		const lookup = {
			tcp: (msg, server) => {
				msg = udpPacketToTcpPacket(msg);
				return Promise.resolve(tcpLookup(msg, server.port, server.host, timeout).then(data => {
					data = tcpPacketToUdpPacket(data);
					msg = null;
					return response(data);
				}));
			},
			udp: (msg, server) => {
				return Promise.resolve(udpLookup(msg, server.port, server.host, timeout).then(data => {
					msg = null;
					return response(data);
				}));
			},
			tls: (msg, server) => {
				msg = udpPacketToTcpPacket(msg);
				return Promise.resolve(tlsLookup(msg, server.port, server.host, timeout).then(data => {
					data = tcpPacketToUdpPacket(data);
					msg = null;
					return response(data);
				}));
			}
		};

		const packet = parseUDPPacket(msg);
		// we can only resolve the first question, as DNSProxy only does "forward"
		// that means DNSProxy won't modify the struct or content of packets mostly,
		// or say most of the data will be transferred "as-is" (except triming or 
		// adding TCP DNS header if needed)
		// thought RFC doesn't say you can only send one question per request, 
		// luckily in practice most of requests has only one question, and some DNS
		// server doesn't accept multiple questions, too
		// see https://stackoverflow.com/questions/4082081
		// so as for now, we can assume all the packets will have only one question
		const resolve = rules.resolve(packet.Question[0].Name);
		const { server, index } = resolve;
		packet.Question.forEach(question => {
			console.log(`[UDP] Query [${question.Name}](${DNSTYPE[question.Type]}) --> ${
				server.host}:${server.port}@${server.type} ${index < 0 ? '' : `(#${index + 1})`}`);
		});
		lookup[server.type](msg, server).catch(err => {
			console.log(`[UDP] (${server.type.toUpperCase()}) Request Data Error (${
				server.host}:${server.port}@${server.type})`);
			console.log(err);
		});
		msg = null;
	});

	udpServer.on('listening', () => {
		let { address, port } = udpServer.address();
		if (isIPv6(address)) {
			address = `[${address}]`;
		}
		console.log(`[UDP] Server listening ${address}:${port}`);
	});

	udpServer.bind(port, host);
	return udpServer;
};

const setupTCPServer = (host, port, timeout, rules) => {
	const tcpServer = net.createServer();

	tcpServer.on('error', err => {
		console.log('[TCP] Server Error');
		console.log(err);
	});

	tcpServer.on('connection', socket => {
		let length = 0;
		let received = Buffer.alloc(0);

		const response = (data) => {
			return new Promise((resolve, reject) => {
				socket.write(data, err => {
					socket.end();
					data = null;
					if (err) {
						return reject(err);
					}
					resolve();
				});
			});
		};
		const lookup = {
			tcp: (msg, server) => {
				return Promise.resolve(tcpLookup(msg, server.port, server.host, timeout).then(data => {
					msg = null;
					return response(data);
				}));
			},
			udp: (msg, server) => {
				msg = tcpPacketToUdpPacket(msg);
				return Promise.resolve(tcpLookup(msg, server.port, server.host, timeout).then(data => {
					data = udpPacketToTcpPacket(data);
					msg = null;
					return response(data);
				}));
			},
			tls: (msg, server) => {
				return Promise.resolve(tlsLookup(msg, server.port, server.host, timeout).then(data => {
					msg = null;
					return response(data);
				}));
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
					console.log(`[TCP] Query [${question.Name}](${DNSTYPE[question.Type]}) --> ${
						server.host}:${server.port}@${server.type} ${index < 0 ? '' : `(#${index + 1})`}`);
				});
				lookup[server.type](received, server).catch(err => {
					console.log(`[TCP] (${server.type.toUpperCase()}) Request Data Error (${
						server.host}:${server.port}@${server.type})`);
					console.log(err);
				});
				received = null;
			}
		});
		socket.on('error', (err) => {
			socket.end();
			console.log('[TCP] Connection Error');
			console.log(err);
			received = null;
		});
	});

	tcpServer.on('listening', () => {
		let { address, port } = tcpServer.address();
		if (isIPv6(address)) {
			address = `[${address}]`;
		}
		console.log(`[TCP] Server listening ${address}:${port}`);
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
	rules.initRules(config.rules, input['config-file']);

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