/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 * Please make sure to make edits in the .ts file at https://github.com/microsoft/vscode-loader/
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *---------------------------------------------------------------------------------------------
 *--------------------------------------------------------------------------------------------*/

'use strict';

interface IGlobalState {
	Plugin?: {
		Resources?: {
			getString?(args: any[]): string;
		}
	};
	document?: {
		location?: {
			hash: string
		}
	}
	nlsPluginEntryPoints: { [entryPoint: string]: string[]; };
}

let _nlsPluginGlobal = this;

module NLSBuildLoaderPlugin {

	let global: IGlobalState = <any>(_nlsPluginGlobal || {});
	let Resources = global.Plugin && global.Plugin.Resources ? global.Plugin.Resources : undefined;
	let IS_PSEUDO = (global && global.document && global.document.location && global.document.location.hash.indexOf('pseudo=true') >= 0);

	export interface IBundledStrings {
		[moduleId: string]: string[];
	}

	export interface ILocalizeInfo {
		key: string;
		comment: string[];
	}

	export interface ILocalizeFunc {
		(info: ILocalizeInfo, message: string, ...args: any[]): string;
		(key: string, message: string, ...args: any[]): string;
	}

	interface IGetLanguageConfigurationFunc {
		(): { [entry: string]: string} | undefined
	}

	export interface IConsumerAPI {
		localize: ILocalizeFunc;
		getLanguageConfiguration: IGetLanguageConfigurationFunc;
	}

	function _format(message: string, args: string[]): string {
		let result: string;

		if (args.length === 0) {
			result = message;
		} else {
			result = message.replace(/\{(\d+)\}/g, (match, rest) => {
				let index = rest[0];
				return typeof args[index] !== 'undefined' ? args[index] : match;
			});
		}

		if (IS_PSEUDO) {
			// FF3B and FF3D is the Unicode zenkaku representation for [ and ]
			result = '\uFF3B' + result.replace(/[aouei]/g, '$&$&') + '\uFF3D';
		}

		return result;
	}

	function findLanguageForModule(config, name) {
		let result = config[name];
		if (result)
			return result;
		result = config['*'];
		if (result)
			return result;
		return null;
	}

	function localize(data, message) {
		let args = [];
		for (let _i = 0; _i < (arguments.length - 2); _i++) {
			args[_i] = arguments[_i + 2];
		}
		return _format(message, args);
	}

	function createScopedLocalize(scope: string[]): ILocalizeFunc {
		return function (idx, defaultValue) {
			let restArgs = Array.prototype.slice.call(arguments, 2);
			return _format(scope[idx], restArgs);
		}
	}

	function getLanguageConfiguration(loadedConfig: AMDLoader.IConfigurationOptions | undefined): IGetLanguageConfigurationFunc {
		return function () {
			if (!loadedConfig?.['vs/nls']?.['availableLanguages']) {
				return undefined;
			}

			return this._loadedConfig['vs/nls']['availableLanguages'];
		}
	}

	export class NLSPlugin implements AMDLoader.ILoaderPlugin {
		static DEFAULT_TAG = 'i-default';
		static BUILD_MAP: { [name: string]: string[]; } = {};
		static BUILD_MAP_KEYS: { [name: string]: string[]; } = {};

		public localize;
		public getLanguageConfiguration: IGetLanguageConfigurationFunc;

		constructor() {
			this.localize = localize;
		}

		public setPseudoTranslation(value: boolean) {
			IS_PSEUDO = value;
		}

		public create(key: string, data: IBundledStrings): IConsumerAPI {
			return {
				localize: createScopedLocalize(data[key]),
				getLanguageConfiguration: this.getLanguageConfiguration,
			}
		}

		public load(name: string, req: AMDLoader.IRelativeRequire, load: AMDLoader.IPluginLoadCallback, config: AMDLoader.IConfigurationOptions): void {
			config = config || {};
			if (!name || name.length === 0) {
				load({
					localize: localize,
					getLanguageConfiguration: this.getLanguageConfiguration
				});
			} else {
				let suffix;
				if (Resources && Resources.getString) {
					suffix = '.nls.keys';
					req([name + suffix], function (keyMap) {
						load({
							localize: function (moduleKey, index) {
								if (!keyMap[moduleKey])
									return 'NLS error: unknown key ' + moduleKey;
								let mk = keyMap[moduleKey].keys;
								if (index >= mk.length)
									return 'NLS error unknown index ' + index;
								let subKey = mk[index];
								let args = [];
								args[0] = moduleKey + '_' + subKey;
								for (let _i = 0; _i < (arguments.length - 2); _i++) {
									args[_i + 1] = arguments[_i + 2];
								}
								return Resources.getString.apply(Resources, args);
							}
						});
					});
				} else {
					if (config.isBuild) {
						req([name + '.nls', name + '.nls.keys'], function (messages: string[], keys: string[]) {
							NLSPlugin.BUILD_MAP[name] = messages;
							NLSPlugin.BUILD_MAP_KEYS[name] = keys;
							load(messages);
						});
					} else {
						let pluginConfig = config['vs/nls'] || {};
						let language = pluginConfig.availableLanguages ? findLanguageForModule(pluginConfig.availableLanguages, name) : null;
						suffix = '.nls';
						if (language !== null && language !== NLSPlugin.DEFAULT_TAG) {
							suffix = suffix + '.' + language;
						}

						req([name + suffix], function (messages) {
							if (Array.isArray(messages)) {
								(<any>messages).localize = createScopedLocalize(messages);
							} else {
								messages.localize = createScopedLocalize(messages[name]);
							}
							(<IConsumerAPI>messages).getLanguageConfiguration = this.getLanguageConfiguration;
							load(messages);
						});
					}
				}
			}
		}

		private _getEntryPointsMap(): { [entryPoint: string]: string[] } {
			global.nlsPluginEntryPoints = global.nlsPluginEntryPoints || {};
			return global.nlsPluginEntryPoints;
		}

		public write(pluginName: string, moduleName: string, write: AMDLoader.IPluginWriteCallback): void {
			// getEntryPoint is a Monaco extension to r.js
			let entryPoint = write.getEntryPoint();

			// r.js destroys the context of this plugin between calling 'write' and 'writeFile'
			// so the only option at this point is to leak the data to a global
			let entryPointsMap = this._getEntryPointsMap();
			entryPointsMap[entryPoint] = entryPointsMap[entryPoint] || [];
			entryPointsMap[entryPoint].push(moduleName);

			if (moduleName !== entryPoint) {
				write.asModule(pluginName + '!' + moduleName, 'define([\'vs/nls\', \'vs/nls!' + entryPoint + '\'], function(nls, data) { return nls.create("' + moduleName + '", data); });');
			}
		}

		public writeFile(pluginName: string, moduleName: string, req: AMDLoader.IRelativeRequire, write: AMDLoader.IPluginWriteFileCallback, config: AMDLoader.IConfigurationOptions): void {
			let entryPointsMap = this._getEntryPointsMap();
			if (entryPointsMap.hasOwnProperty(moduleName)) {
				let fileName = req.toUrl(moduleName + '.nls.js');
				let contents = [
					'/*---------------------------------------------------------',
					' * Copyright (c) Microsoft Corporation. All rights reserved.',
					' *--------------------------------------------------------*/'
				],
					entries = entryPointsMap[moduleName];

				let data: { [moduleName: string]: string[]; } = {};
				for (let i = 0; i < entries.length; i++) {
					data[entries[i]] = NLSPlugin.BUILD_MAP[entries[i]];
				}

				contents.push('define("' + moduleName + '.nls", ' + JSON.stringify(data, null, '\t') + ');');
				write(fileName, contents.join('\r\n'));
			}
		}

		public finishBuild(write: AMDLoader.IPluginWriteFileCallback): void {
			write('nls.metadata.json', JSON.stringify({
				keys: NLSPlugin.BUILD_MAP_KEYS,
				messages: NLSPlugin.BUILD_MAP,
				bundles: this._getEntryPointsMap()
			}, null, '\t'));
		};
	}

	(function () {
		define('vs/nls', new NLSPlugin());
	})();
}
