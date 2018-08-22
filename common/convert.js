const udpPacketToTcpPacket = (data) => {
	const length = data.byteLength;
	if (length > 512) {
		console.warn(`*UDP->TCP* Packet size is ${length}, which is larger than 512, request data maybe invalid.`);
	}
	return Buffer.concat([Buffer.from([length >> 8, length & 255]), data]);
};

const tcpPacketToUdpPacket = (data, tc = false) => {
	const length = (data[0] << 8) + data[1];
	data = data.slice(2);
	const actualLength = data.byteLength;
	if (actualLength !== length) {
		console.warn(`*TCP->UDP* Packet size doesn't match, expected ${length} but got ${actualLength}, request data maybe invalid.`);
	}
	if (actualLength > 512) {
		if (tc) {
			data = data.split(0, 512);
			// set TC to 1
			data[2] |= 2;
			console.warn('*TCP->UDP* Packet size is larger than 512 bytes, data is truncated and TC is set to true.');
		}
		else {
			console.warn('*TCP->UDP* Packet size is larger than 512 bytes, data is not truncated but response data maybe not acceptable.');
		}
	}
	return data;
};

module.exports = {
	udpPacketToTcpPacket,
	tcpPacketToUdpPacket
};