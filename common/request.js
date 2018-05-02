const dgram = require('dgram');
const net = require('net');
const { isIPv6 } = require('./utils');

const udpLookup = (msg, port, address) => {
	return new Promise((resolve, reject) => {
		const client = dgram.createSocket(isIPv6(address) ? 'udp6' : 'udp4');
		client.on('message', data => {
			client.close();
			resolve(data);
			data = null;
		});
		client.on('error', reject);
		client.send(msg, port, address, err => {
			if (err) {
				reject(err);
			}
		});
	});
};

const tcpLookup = (msg, port, address) => {
	return new Promise((resolve, reject) => {
		let length = 0;
		let received = Buffer.alloc(0);

		const client = net.createConnection(port, address, err => {
			if (err) {
				reject(err);
			}
		});
		client.on('data', data => {
			// record total packet size in case data maybe split
			if (length === 0) {
				// first 2 bytes (packet size) is not included
				length = (data[0] << 8) + data[1] + 2;
			}
			received = Buffer.concat([received, data]);
			data = null;

			if (received.byteLength === length) {
				client.end();
				resolve(received);
				received = null;
			}
		});
		client.on('error', reject);
		client.write(msg);
	});
};

module.exports = {
	udpLookup,
	tcpLookup
};