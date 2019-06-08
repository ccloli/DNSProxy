const dgram = require('dgram');
const net = require('net');
const tls = require('tls');
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
			client.removeAllListeners();
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		});
		client.on('error', (err) => {
			msg = null;
			client.removeAllListeners();
			reject(err);
		});
		client.send(msg, port, address, err => {
			msg = null;
			if (err) {
				client.removeAllListeners();
				reject(err);
			}
		});

		if (timeout) {
			timer = setTimeout(() => {
				timer = null;
				if (!closed) {
					client.close();
					reject(new Error('Request timed out'));
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
				client.removeAllListeners();
			}
		});
		client.on('close', () => {
			closed = true;
			client.removeAllListeners();
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
			client.removeAllListeners();
			reject(err);
		});
		client.write(msg);
		msg = null;

		if (timeout) {
			timer = setTimeout(() => {
				timer = null;
				if (!closed) {
					client.end();
					reject(new Error('Request timed out'));
				}
			}, timeout);
		}
	});
};

const tlsLookup = (msg, port, address, timeout) => {
	return new Promise((resolve, reject) => {
		let closed = false;
		let timer;
		let length = 0;
		let received = Buffer.alloc(0);

		const client = tls.connect(port, address, err => {
			if (err) {
				msg = null;
				reject(err);
				client.removeAllListeners();
			}
		});
		client.on('close', () => {
			closed = true;
			client.removeAllListeners();
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
				// TODO: reuse TLS connection
				//
				// Thought RFC7766 says closing after each request is common, it doesn't
				// say we cannot reuse the connection, and creating a TLS connection takes
				// more time than a normal TCP connection as the client and server needs
				// more steps to handshake.
				//
				//  > RFC7766 DNS over TCP 
				//  > 6.1.1.  Clients
				//  >    There is no clear guidance today in any RFC as to when a DNS client
				//  >    should close a TCP connection, and there are no specific
				//  >    recommendations with regard to DNS client idle timeouts.However, at
				//  >    the time of writing, it is common practice for clients to close the
				//  >    TCP connection after sending a single request (apart from the SOA/
				//  >    AXFR case).
				//
				// So in RFC7858, it says we shouldn't close the connection immediately, and
				// we should reuse the connection until it's idle.
				//
				//  > RFC7858 DNS over TLS
				//  > 3.4.  Connection Reuse, Close, and Reestablishment
				//  >    In order to amortize TCP and TLS connection setup costs, clients and
				//  >    servers SHOULD NOT immediately close a connection after each
				//  >    response.Instead, clients and servers SHOULD reuse existing
				//  >    connections for subsequent queries as long as they have sufficient
				//  >    resources.In some cases, this means that clients and servers may
				//  >    need to keep idle connections open for some amount of time.
				//  >
				//  >    Proper management of established and idle connections is important to
				//  >    the healthy operation of a DNS server.An implementor of DNS over
				//  >    TLS SHOULD follow best practices for DNS over TCP, as described in
				//  >    [RFC7766].Failure to do so may lead to resource exhaustion and
				//  >    denial of service.
				//
				// However we cannot split packets if multiple DNS requests are responsing
				// at this time, and we don't have a good algorithm to make sure when the 
				// socket is idle and can close the connection safely. 
				//
				//  > RFC7766 DNS over TCP 
				//  > 6.2.3.  Idle Timeouts
				//  >    To mitigate the risk of unintentional server overload, DNS clients
				//  >    MUST take care to minimise the idle time of established DNS-over-TCP
				//  >    sessions made to any individual server.  DNS clients SHOULD close the
				//  >    TCP connection of an idle session, unless an idle timeout has been
				//  >    established using some other signalling mechanism, for example,
				//  >    [edns-tcp-keepalive].
				//
				// So at this time, we'll close each connection when it responses, but this
				// may makes your other software get confused if it doesn't get response in
				// time. For example, when I testing the TLS lookup with CloudFlare TLS DNS
				// (1.1.1.1:853) using Windows `nslookup`, sometimes I got `DNS request timed 
				// out.	timeout was 2 seconds.`.
				client.end();
				resolve(received);
				received = null;
			}
		});
		client.on('error', (err) => {
			msg = null;
			client.removeAllListeners();
			reject(err);
		});
		client.write(msg);
		msg = null;

		if (timeout) {
			timer = setTimeout(() => {
				timer = null;
				if (!closed) {
					client.end();
					reject(new Error('Request timed out'));
				}
			}, timeout);
		}
	});
};

module.exports = {
	udpLookup,
	tcpLookup,
	tlsLookup
};