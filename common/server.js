const dgram = require('dgram');
const net = require('net');
const { udpLookup, tcpLookup, tlsLookup } = require('./request');
const { tcpResolve, udpResolve } = require('./resolve');
const { udpPacketToTcpPacket, tcpPacketToUdpPacket } = require('./convert');
const { parseTCPPacket, parseUDPPacket } = require('./packet-parser');
const { isIPv6, isWildcardIP, isLookbackIP, isLocalIP, isSameIP, addIPv6Bracket, ipToBuffer } = require('./utils');
const { DNSTYPE } = require('./consts');

const getAction = (packet, rules, { host, port, type }) => {
	// we can only resolve the first question, as DNSProxy only does "forward"
	// that means DNSProxy won't modify the struct or content of packets mostly,
	// or say most of the data will be transferred "as-is" (except triming or 
	// adding TCP DNS header if needed)
	// thought RFC doesn't say you can only send one question per request, 
	// luckily in practice most of requests has only one question, and some DNS
	// server doesn't accept multiple questions, too
	// see https://stackoverflow.com/questions/4082081
	// so as for now, we can assume all the packets will have only one question
	const result = rules.resolve(packet.Question[0].Name, packet.Question[0].Type);
	let { server, resolve, index } = result;

	if (resolve) {
		resolve = Object.assign({}, resolve);
		// if data.type is the name of type, replace it with its type number
		// e.g. 'aaaa' -> 28
		if (!/^\d+$/.test(resolve.type)) {
			resolve.type = DNSTYPE[resolve.type.toUpperCase()];
		}

		return {
			type: 'resolve',
			data: resolve,
			index
		};
	}
	else {
		server = Object.assign({}, server);
		server.type = server.type || type;

		if (isIPv6(server.host)) {
			server.host = addIPv6Bracket(server.host);
		}
		if (
			server.port === port && (isWildcardIP(host) ?
				isLocalIP(server.host) || isLookbackIP(server.host) :
				isSameIP(host, server.host)
			)
		) {
			// forward to proxy server itself!
			console.log(`[${type.toUpperCase()}] Query [${packet.Question[0].Name}] forward to proxy server itself`);
			return null;
		}

		return {
			type: 'lookup',
			data: server,
			index
		};
	}
};

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
		const resolve = (data, packet) => {
			const { Header, Question } = packet;
			const { id } = Header;
			const RData = ipToBuffer(data.data);
			const Answer = Question.map(({ Name, Class }) => ({
				Name,
				Type: data.type,
				Class,
				TTL: 60,
				RDLength: RData.length,
				RData
			}));
			return response(udpResolve(id, Question, Answer));
		};

		const packet = parseUDPPacket(msg);
		const action = getAction(packet, rules, { host, port, type: 'udp'});
		if (action) {
			const { type, data, index } = action;
			if (type === 'resolve') {
				packet.Question.forEach(question => {
					console.log(`[UDP] Query [${question.Name}](${DNSTYPE[question.Type]}) <-- ${
						data.data} {${DNSTYPE[data.type]}} ${index < 0 ? '' : `(#${index + 1})`}`);
				});
				resolve(data, packet).catch(err => {
					console.log('[UDP] Resolve Data Error');
					console.log(err);
				});
			}
			else if (type === 'lookup') {
				const server = data;
				packet.Question.forEach(question => {
					console.log(`[UDP] Query [${question.Name}](${DNSTYPE[question.Type]}) --> ${
						server.host}:${server.port}@${server.type} ${index < 0 ? '' : `(#${index + 1})`}`);
				});
				lookup[server.type](msg, server).catch(err => {
					console.log(`[UDP] (${server.type.toUpperCase()}) Request Data Error (${
						server.host}:${server.port}@${server.type})`);
					console.log(err);
				});
			}
		}
		msg = null;
	});

	udpServer.on('listening', () => {
		let { address, port } = udpServer.address();
		if (isIPv6(address)) {
			address = addIPv6Bracket(address);
		}
		console.log(`[UDP] Server listening ${address}:${port}`);
	});

	udpServer.on('close', () => {
		console.log('[UDP] Server closed!');
		udpServer.removeAllListeners();
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
		let closed = false;
		let timer;

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
				return Promise.resolve(udpLookup(msg, server.port, server.host, timeout).then(data => {
					if (data[2] & 2) {
						console.log('[TCP] (UDP) Response data is truncated, try looking up with TCP');
						return lookup.tcp(udpPacketToTcpPacket(msg), server);
					}
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
		const resolve = (data, packet) => {
			const { Header, Question } = packet;
			const { id } = Header;
			const RData = ipToBuffer(data.data);
			const Answer = Question.map(({ Name, Class }) => ({
				Name,
				Type: data.type,
				Class,
				TTL: 60,
				RDLength: RData.length,
				RData
			}));
			return response(tcpResolve(id, Question, Answer));
		};

		socket.on('data', msg => {
			if (length === 0) {
				length = (msg[0] << 8) + msg[1];
			}
			received = Buffer.concat([received, msg]);
			msg = null;

			if (length + 2 === received.byteLength) {
				const packet = parseTCPPacket(received);
				const action = getAction(packet, rules, { host, port, type: 'tcp' });
				if (action) {
					const { type, data, index } = action;
					if (type === 'resolve') {
						packet.Question.forEach(question => {
							console.log(`[TCP] Query [${question.Name}](${DNSTYPE[question.Type]}) <-- ${
								data.data} {${DNSTYPE[data.type]}} ${index < 0 ? '' : `(#${index + 1})`}`);
						});
						resolve(data, packet).catch(err => {
							console.log('[TCP] Resolve Data Error');
							console.log(err);
						});
					}
					else if (type === 'lookup') {
						const server = data;
						packet.Question.forEach(question => {
							console.log(`[TCP] Query [${question.Name}](${DNSTYPE[question.Type]}) --> ${
								server.host}:${server.port}@${server.type} ${index < 0 ? '' : `(#${index + 1})`}`);
						});
						lookup[server.type](msg, server).catch(err => {
							console.log(`[TCP] (${server.type.toUpperCase()}) Request Data Error (${
								server.host}:${server.port}@${server.type})`);
							console.log(err);
						});
					}
				}
				received = null;
			}
		});
		socket.on('error', (err) => {
			socket.end();
			console.log('[TCP] Connection Error');
			console.log(err);
			received = null;
		});
		socket.on('close', () => {
			socket.removeAllListeners();
			socket = null;
			if (timer) {
				clearTimeout(timer);
			}
		});

		if (timeout) {
			timer = setTimeout(() => {
				if (!closed) {
					socket.end();
					console.log('[TCP] Connection timed out');
					timer = null;
					socket = null;
				}
			}, timeout);
		}
	});

	tcpServer.on('listening', () => {
		let { address, port } = tcpServer.address();
		if (isIPv6(address)) {
			address = addIPv6Bracket(address);
		}
		console.log(`[TCP] Server listening ${address}:${port}`);
	});

	tcpServer.on('close', () => {
		console.log('[TCP] Server closed!');
		tcpServer.removeAllListeners();
	});

	tcpServer.listen(port, host);
	return tcpServer;
};

module.exports = {
	setupUDPServer,
	setupTCPServer
};