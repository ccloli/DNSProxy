const dgram = require('dgram');
const net = require('net');
const { isIPv6 } = require('./utils');

const udpLookup = (msg, port, address, timeout) => {
	return new Promise((resolve, reject) => {
		let closed = false;
		let timer;
		const client = dgram.createSocket(isIPv6(address) ? 'udp6' : 'udp4');

		client.on('message', data => {
			client.close();
			resolve(data);
			data = null;
		});
		client.on('close', () => {
			closed = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		});
		client.on('error', (err) => {
			msg = null;
			reject(err);
		});
		client.send(msg, port, address, err => {
			msg = null;
			if (err) {
				reject(err);
			}
		});

		if (timeout) {
			timer = setTimeout(() => {
				timer = null;
				if (!closed) {
					client.close();
					reject(new Error('No data response'));
				}
			}, timeout);
		}
	});
};

const tcpLookup = (msg, port, address, timeout) => {
	return new Promise((resolve, reject) => {
		let closed = false;
		let timer;
		let length = 0;
		let received = Buffer.alloc(0);

		const client = net.createConnection(port, address, err => {
			if (err) {
				msg = null;
				reject(err);
			}
		});
		client.on('close', () => {
			closed = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
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
		client.on('error', (err) => {
			msg = null;
			reject(err);
		});
		client.write(msg);
		msg = null;

		if (timeout) {
			timer = setTimeout(() => {
				timer = null;
				if (!closed) {
					client.close();
					reject(new Error('No data response'));
				}
			}, timeout);
		}
	});
};

module.exports = {
	udpLookup,
	tcpLookup
};