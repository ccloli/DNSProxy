const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, '../parsers/');

class RuleParser {
	constructor() {
		this.defaultServer = null;
		this.parser = {};
		this.rules = [];
	}

	initDefaultServer(server) {
		this.defaultServer = server;
	}

	initParsers(extendPath = []) {
		const parser = {};

		let defaultPath = fs.readdirSync(dir).filter(e => /\.js$/.test(e));
		defaultPath = defaultPath.map(e => path.resolve(dir, e));
		extendPath = extendPath.map(e => path.resolve(process.cwd(), e));

		[...defaultPath, ...extendPath].forEach(item => {
			try {
				const cur = require(item);
				if (!cur.name) {
					throw new SyntaxError(`Parser file '${item}' does't specify its name`);
				}
				if (!cur.prototype.parse || !cur.prototype.test) {
					throw new SyntaxError(`Parser ${cur.name} doesn't provide parse() or test() method`);
				}
				parser[cur.name] = cur;
			}
			catch (err) {
				console.log(`Fail to import parser file '${item}'`);
				console.log(err);
			}
		});

		this.parser = parser;
	}

	initRules(rules = []) {
		this.inputRules = rules;

		// TODO: use asynchronous way to parse
		// Promise.all(rules.map((elem, index) => {
		this.rules = rules.map((elem, index) => {
			let { type, file, server } = elem;

			try {
				const Parser = this.parser[type];
				if (!Parser) {
					throw new ReferenceError(`Parser '${type}' is not defined`);
				}

				const exactFile = path.resolve(process.cwd(), file);

				try {
					const data = fs.readFileSync(exactFile, 'utf8');

					const parser = new Parser();
					parser.parse(data);

					return {
						file,
						exactFile,
						index,
						server,
						parser
					};
				}
				catch (err) {
					console.log(`Parser '${type}' cannot resolve file '${file}'`);
					console.log(err);
					return;
				}
			}
			catch (err) {
				console.log(`Rule #${index} cannot be parsed`);
				console.log(err);
			}
		});
	}

	resolve(domain) {
		domain = domain.toLowerCase();
		const len = domain.length;
		// remove the last dot, but keep the dot if querying root server
		if (domain[len - 1] === '.' && len > 1) {
			domain = domain.substr(0, len - 1);
		}
		for (let rule of this.rules) {
			const { file, index, server, parser } = rule;
			if (parser.test(domain)) {
				return {
					file,
					index,
					server
				};
			}
		}
		return this.defaultServer ? {
			file: null,
			index: -1,
			server: this.defaultServer
		} : null;
	}
}

module.exports = RuleParser;