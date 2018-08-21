/**
 * Rule type: list
 * 
 * @class list
 */
class list {
	constructor(config) {
		this.pattern = [];
		this.include = [];
		this.exclude = [];
		this.server = null;

		if (config) {
			this.init(config);
		}
	}

	/**
	 * Parse wildcard rule to regex
	 * 
	 * @private 
	 * @param {string} str - rule
	 * @returns {RegExp} parsed regex
	 * @memberof list
	 */
	parseWildcard(str) {
		const charMap = {
			'.': '\\.',
			'*': '.*',
			'?': '.'
		};
		let res = str.replace(/[.*?]/g, c => charMap[c]);
		// if first character is dot, then treat it as `*.` or `@.`(null)
		// e.g. `.example.com` will be `*.example.com` and `example.com`
		res = res.replace(/^\\\./, '(.*\\.)?');
		return new RegExp(`^${res}$`);
	}

	/**
	 * Parse regex rule to regex
	 * 
	 * @private 
	 * @param {string} str - rule
	 * @returns {RegExp} parsed regex
	 * @memberof list
	 */
	parseRegExp(str) {
		const pattern = str.match(/^\/(.+)\/([a-zA-Z]*?)$/);
		if (pattern) {
			return new RegExp(pattern[1], pattern[2] || undefined);
		}
		else {
			return new RegExp(str);
		}
	}

	/**
	 * Init parser
	 * 
	 * Check if the file is exist, if not exist, throw an error,
	 * else, save server and call this.parse() to parse file
	 * 
	 * @param {object} config - the config object needed to init
	 * @param {string} config.file - the rules to be parsed
	 * @param {object} config.server - the server to return if a domain matches
	 * @memberof list
	 */
	init({ file, server }) {
		if (!file) {
			throw new Error('Field \'file\' is required for list parser');
		}
		if (!server) {
			throw new Error('Field \'server\' is required for list parser');
		}
		this.server = server;
		this.parse(file);
	}

	/**
	 * Parse input data, save parsed patterns to this.patterns
	 * 
	 * Put include and exclude indexes to this.include and this.exclude,
	 * so that when searching one rule type, the other one will not in queue,
	 * so that we can skip most the unwanted data
	 * 
	 * @private
	 * @param {string} data - the data needs to parse
	 * @memberof list
	 */
	parse(data) {
		const list = data.split(/\r?\n/);
		const pattern = [];
		const include = [];
		const exclude = [];
		list.forEach(elem => {
			try {
				let target = include;
				elem = elem.replace(/#.*/, '').trim();

				if (elem[0] === '-') {
					target = exclude;
					elem = elem.substr(1);
				}
				if (!elem) {
					return;
				}

				// `pattern` only store pattern
				if (elem[0] === '/') {
					pattern.push(this.parseRegExp(elem));
				}
				else {
					pattern.push(this.parseWildcard(elem));
				}

				// cross-save indexes will help us split data and use in foreach
				const index = pattern.length - 1;
				target[index] = index;
			}
			catch(err) {
				console.log(`Fail to parse rule ${elem}`);
				console.log(err);
			}
		});
		this.pattern = pattern;
		this.include = include;
		this.exclude = exclude;
	}

	/**
	 * Test if domain matches include or exclude rules
	 * 
	 * If a rule matches one of include rules, then it'll test the rest 
	 * of exclude rules, and if it matches one, it'll test the rest of 
	 * include rules, and so on, until test all the rest rules.
	 * 
	 * @private
	 * @param {string} host - the domain name needs to be checked
	 * @param {boolean} [exclude=false] - test exclude rules or not
	 * @param {number} [index=0] - start index
	 * @returns  {boolean} the host should be include or not
	 * @memberof list
	 */
	crossTest(host, exclude = false, index = 0) {
		// test include first, then exclude
		// 
		// if we don't set the field in array, it'll be a `empty` field,
		// use `for...in` and ES5 Array methods will ignore `empty` fields
		// with this way we can skip most unwanted rules to test
		// (however `for...of` will include `empty` field ¯\_(ツ)_/¯)
		//
		// if `for...of` ignores the `empty` field, the code can be written as
		/*
		for (let i of this.include.slice(index)) {
			if (this.pattern[i].test(host)) {
				for (let j of this.exclude.slice(i)) {
					if (this.pattern[j].test(host)) {
						return this.crossTest(host, j);
					}
				}
				return true;
			}
		}
		return false;
		*/

		// assume host doesn't match any rules
		let res = false;
		const target = exclude ? this.exclude : this.include;

		// use `Array.prototype.some` to iterate the array,
		// as `for...of` will include the empty fields
		// but we don't use the return result as the final result,
		// because if the result is `false`, it'll continue to test the rest,
		// so we record the result manually, and use `return true` to break the loop
		target.slice(index).some(i => {
			// as we cross-save indexes in `include` and `exclude`,
			// `i` is the real index of target pattern
			if (this.pattern[i].test(host)) {
				// host matches any rules
				// test the rest of another type rules
				// `res` is the final result
				res = !this.crossTest(host, !exclude, i);
				// `return true` only means break the loop
				return true;
			}
		});

		return res;
	}

	/**
	 * Test if domain matches one of the rules
	 * 
	 * @public 
	 * @param {string} host - the domain name needs to be checked
	 * @returns {object|null} if the domain name matches, return { server }, or return null
	 * @memberof list
	 */
	test(host) {
		return this.crossTest(host) ? {
			server: this.server
		} : null;
	}
}

module.exports = list;