const { intToBuffer } = require('./utils');

// sorry the packet naming style is CamelCase but not camelCase,
// as I'm not sure how to measure upper names like `AA`, `TC`, `RD`, `RA`, `Z`,
// also here comes a preserve keyword `class`

const generateHeader = (data) => {
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
	const id = intToBuffer(data.id, 2);
	const config = intToBuffer(
		data.QR << 15 +
		data.OPCode << 11 +
		data.AA << 10 +
		data.TC << 9 +
		data.RD << 8 +
		data.RA << 7 +
		data.Z << 4 +
		data.RCode, 2);
	const QDCount = intToBuffer(data.QDCount, 2);
	const ANCount = intToBuffer(data.ANCount, 2);
	const NSCount = intToBuffer(data.NSCount, 2);
	const ARCount = intToBuffer(data.ARCount, 2);

	return Buffer.concat(id, config, QDCount, ANCount, NSCount, ARCount);
};

const generateLookupName = (data) => {
	// TODO: compression
	return Buffer.concat(data.split('.').map(e => Buffer.concat([
		intToBuffer(e.length, 1), Buffer.from(e, 'binary')
	])));
};

const generateQuestion = (data) => {
	// Question struct:
	//   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// :                     QNAME                     :
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                     QTYPE                     |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                     QCLASS                    |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	const Name = intToBuffer(generateLookupName(data.Name));
	const Type = intToBuffer(data.Type, 2);
	const Class = intToBuffer(data.Class, 2);
	
	return Buffer.concat(Name, Type, Class);
};

const generateAnswer = (data) => {
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
	const Name = intToBuffer(generateLookupName(data.Name));
	const Type = intToBuffer(data.Type, 2);
	const Class = intToBuffer(data.Class, 2);
	const TTL = intToBuffer(data.TTL, 4);
	const RDLength = intToBuffer(data.RDLength, 2);
	const RData = data.RData;

	return Buffer.concat(Name, Type, Class, TTL, RDLength, RData);
};

// Authority and Additional are using the same struct as Answer
const generateAuthority = generateAnswer;
const generateAdditional = generateAnswer;


const generatePacket = (data, tcp) => {
	const { Header, Question, Answer, Authority, Additional } = data;
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
	let packet = Buffer.concat([
		generateHeader(Header),
		generateQuestion(Question),
		generateAnswer(Answer),
		generateAuthority(Authority),
		generateAdditional(Additional)
	]);
	// TCP DNS Packet structure
	//   0  1  2  3  4  5  6  7  8  9 10 11 12 13 14 15
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// |                DNS Packet Size                |
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	// :                UDP DNS Packet                 :
	// +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
	if (tcp) {
		return Buffer.concat([intToBuffer(packet.length, 2), packet]);
	}
	return packet;
};

const generateUDPPacket = (data) => {
	return generatePacket(data, false);
};

const generateTCPPacket = (data) => {
	return generatePacket(data, true);
};

module.exports = {
	generateTCPPacket,
	generateUDPPacket,
	generateLookupName
};