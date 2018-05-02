/**
 * Rule type: list
 * 
 * @class list
 */
class list {
	constructor(data) {
		this.patterns = [];

		if (data) {
			this.parse(data);
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
		if (str[0] === '.') {
			str = '*' + str;
		}
		return new RegExp(`^${str.replace(/[.*?]/, c => charMap[c])}$`);
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
	 * Parse input data, save parsed data to this.patterns
	 * 
	 * @public 
	 * @param {string} data - the data needs to parse
	 * @memberof list
	 */
	parse(data) {
		const list = data.split(/\r?\n/).map(e => e.trim()).filter(e => e && e[0] !== '#');
		const parsed = list.map(elem => {
			try {
				if (elem[0] === '/') {
					return this.parseRegExp(elem);
				}
				return this.parseWildcard(elem);
			}
			catch(e) {
				console.log(`Fail to parse rule ${elem}`);
				console.log(e);
			}
		}).filter(e => e);
		this.patterns = parsed;
	}

	/**
	 * Test if domain matches one of the rules
	 * 
	 * @public 
	 * @param {string} host - the domain name needs to be checked
	 * @returns {boolean} the host matches the rules or not
	 * @memberof list
	 */
	test(host) {
		for (let pattern of this.patterns) {
			if (pattern.test(host)) {
				return true;
			}
		}
		return false;
	}
}

module.exports = list;