/**
 * Rule type: list
 * 
 * @class list
 */
class list {
	constructor(data) {
		this.include = [];
		this.exclude = [];

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
	 * Parse input data, save parsed data to this.patterns
	 * 
	 * @public 
	 * @param {string} data - the data needs to parse
	 * @memberof list
	 */
	parse(data) {
		const list = data.split(/\r?\n/);
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

				if (elem[0] === '/') {
					target.push(this.parseRegExp(elem));
				}
				else {
					target.push(this.parseWildcard(elem));
				}
			}
			catch(err) {
				console.log(`Fail to parse rule ${elem}`);
				console.log(err);
			}
		});
		this.include = include.filter(e => e);
		this.exclude = include.filter(e => e);
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
		// test include first
		for (let pattern of this.include) {
			if (pattern.test(host)) {
				// host matches any include rules
				for (let pattern of this.exclude) {
					if (pattern.test(host)) {
						// host matches any exclude rules
						return false;
					}
				}
				// host doesn't match any exclude rules
				return true;
			}
		}
		// host doesn't match any include rules
		return false;
	}
}

module.exports = list;