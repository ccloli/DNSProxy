const { sumBuffer } = require('./utils');

// sorry the packet naming style is CamelCase but not camelCase,
// as I'm not sure how to measure upper names like `AA`, `TC`, `RD`, `RA`, `Z`,
// also here comes a preserve keyword `class`

const parseHeader = (data) => {
	// Header struct:
	//   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                      ID                       |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |QR|   Opcode  |AA|TC|RD|RA|   Z    |   RCODE   |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                    QDCOUNT                    |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                    ANCOUNT                    |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                    NSCOUNT                    |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                    ARCOUNT                    |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	const id = sumBuffer(data.slice(0, 2));
	const config = sumBuffer(data.slice(2, 4));
	const QDCount = sumBuffer(data.slice(4, 6));
	const ANCount = sumBuffer(data.slice(6, 8));
	const NSCount = sumBuffer(data.slice(8, 10));
	const ARCount = sumBuffer(data.slice(10, 12));
	// deserialize config
	const QR = config >> 15;
	const OPCode = config >> 11 & 15;
	const AA = config >> 10 & 1;
	const TC = config >> 9 & 1;
	const RD = config >> 8 & 1;
	const RA = config >> 7 & 1;
	const Z = config >> 4 & 7;
	const RCode = config & 15;

	return {
		id, QR, OPCode, AA, TC, RD, RA, Z, RCode,
		QDCount, ANCount, NSCount, ARCount
	};
};

const parseLookupName = (data, offset) => {
	let lastIndex = offset;
	const parse = (pieces) => {
		const length = pieces[0];
		// as RFC 1035 Sec. 4.1.4 defines,
		// if the length byte's high 2 bit is `11`, 
		// the low 6 bit should be the high 6 bit of compressed data offset
		// and the offset is a 14 bit integer
		//   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
		// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
		// | 1  1|                OFFSET                   |
		// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
		if (length >> 6 === 3) {
			const targetOffset = sumBuffer(pieces.slice(0, 2)) & 0x3fff;
			lastIndex += 2;
			return parseLookupName(data, targetOffset).data;
		}

		lastIndex += 1 + length;
		if (length === 0) {
			return '';
		}
		else {
			const cur = pieces.slice(1, 1 + length);
			if (cur.byteLength !== length) {
				throw new Error('Domain name is incomplete.');
			}
			return cur.toString('binary') + '.' + parse(pieces.slice(1 + length));
		}
	};
	return {
		data: parse(data.slice(offset)) || '.',
		byteLength: lastIndex - offset
	};
};

const parseQuestion = (data, length = 0, offset = 0) => {
	// Question struct:
	//   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// :                     QNAME                     :
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                     QTYPE                     |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                     QCLASS                    |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	let res = [];
	let lastIndex = offset;
	while (length--) {
		const { data: Name, byteLength: index } = parseLookupName(data, lastIndex);
		lastIndex += index;
		const Type = sumBuffer(data.slice(lastIndex, lastIndex + 2));
		const Class = sumBuffer(data.slice(lastIndex + 2, lastIndex + 4));
		lastIndex += 4;
		res.push({ Name, Type, Class });
	}
	return {
		data: res,
		byteLength: lastIndex - offset
	};
};

const parseAnswer = (data, length = 0, offset = 0) => {
	//   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// :                     NAME                      :
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                     TYPE                      |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                     CLASS                     |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                      TTL                      |
	// |                                               |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                   RDLENGTH                    |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--|
	// :                     RDATA                     :
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	let res = [];
	let lastIndex = offset;
	while (length--) {
		const { data: Name, byteLength: index } = parseLookupName(data, lastIndex);
		lastIndex += index;
		const Type = sumBuffer(data.slice(lastIndex, lastIndex + 2));
		const Class = sumBuffer(data.slice(lastIndex + 2, lastIndex + 4));
		const TTL = sumBuffer(data.slice(lastIndex + 4, lastIndex + 8));
		const RDLength = sumBuffer(data.slice(lastIndex + 8, lastIndex + 10));
		lastIndex += 10;
		const RData = data.slice(lastIndex, lastIndex + RDLength);
		lastIndex += RDLength;
		res.push({ Name, Type, Class, TTL, RDLength, RData });
	}
	return {
		data: res,
		byteLength: lastIndex - offset
	};
};

// Authority and Additional are using the same struct as Answer
const parseAuthority = parseAnswer;
const parseAdditional = parseAnswer;


const parsePacket = (data, tcp) => {
	const packet = {};
	const offset = {};
	packet.__offset = offset;
	let packetOffset = 0;
	let nextOffset = 0;

	// TCP DNS Packet structure
	//   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                DNS Packet Size                |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// :                UDP DNS Packet                 :
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	if (tcp) {
		offset.Length = 0;
		packet.Length = sumBuffer(data.slice(0, 2));
		packetOffset = 2;
		data = data.slice(2);
	}

	// UDP DNS Packet structure
	// +----------------+
	// |     Header     |
	// +----------------+
	// |    Question    |
	// +----------------+
	// |     Answer     |
	// +----------------+
	// |   Authority    |
	// +----------------+
	// |   Additional   |
	// +----------------+
	offset.Header = nextOffset + packetOffset;
	packet.Header = parseHeader(data.slice(nextOffset, nextOffset + 12));
	nextOffset += 12;

	const { QDCount, ANCount, NSCount, ARCount } = packet.Header;
	if (QDCount >= 0) {
		offset.Question = nextOffset + packetOffset;
		const { data: res, byteLength } = parseQuestion(data, QDCount, nextOffset);
		nextOffset += byteLength;
		packet.Question = res;
	}
	if (ANCount >= 0) {
		offset.Answer = nextOffset + packetOffset;
		const { data: res, byteLength } = parseAnswer(data, ANCount, nextOffset);
		nextOffset += byteLength;
		packet.Answer = res;
	}
	if (NSCount >= 0) {
		offset.Authority = nextOffset + packetOffset;
		const { data: res, byteLength } = parseAuthority(data, NSCount, nextOffset);
		nextOffset += byteLength;
		packet.Authority = res;
	}
	if (ARCount >= 0) {
		offset.Additional = nextOffset + packetOffset;
		const { data: res, byteLength } = parseAdditional(data, ARCount, nextOffset);
		nextOffset += byteLength;
		packet.Additional = res;
	}

	return packet;
};

const parseUDPPacket = (data) => {
	return parsePacket(data, false);
};

const parseTCPPacket = (data) => {
	return parsePacket(data, true);
};

module.exports = {
	parseTCPPacket,
	parseUDPPacket,
	parseLookupName
};