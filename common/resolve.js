const { generateTCPPacket, generateUDPPacket } = require('./packet-generator');

const resolve = (id, question, answer, tcp) => {
	if (question && !(question instanceof Array)) {
		question = [question];
	}
	if (answer && !(answer instanceof Array)) {
		answer = [answer];
	}
	const config = {
		Header: {
			id,
			QR: 1, // message is a response
			OPCode: 0, // standard query
			AA: 0, // no auth
			TC: 0, // not truncated
			RD: 0, // not do query recursively
			RA: 0, // server cannot do recursive query
			Z: 0, // reversed
			RCode: 0, // no error
			QDCount: question.length, // query count
			ANCount: answer.length, // answer count
			NSCount: 0, // auth count
			ARCount: 0 // additional count
		},
		Question: question,
		Answer: answer,
		Authority: [],
		Additional: [],
	};

	if (tcp) {
		return generateTCPPacket(config);
	}
	return generateUDPPacket(config);
};

const udpResolve = (id, question, answer) => {
	return resolve(id, question, answer, false);
};

const tcpResolve = (id, question, answer) => {
	return resolve(id, question, answer, true);
};

module.exports = {
	udpResolve,
	tcpResolve
};
