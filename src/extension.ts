///
/// VSCode extention: DynamicTemplate
///
/// Scenario:
/// 1. User invokes a command to expand template.
///
/// 2. This extension loads config files under various folders
///    a. ~/.vscode/extensions/<id>/template.js
///    b. <wsroot>/.vscode/extensions/<id>/template.js, if ws contains the anchorPoint
///    c. Will NOT use storagePath/globalStoragePath
///       - Path is too deep for user to edit files under it.
///       - These seems to be managed by extension, not directly by user.
///
/// 3. User is asked to choose template from the list
///
/// 4. If the chosen template requires base folder to be set, user will be asked to choose/edit from followings:
///    a. If previous selection is available, add it to the list.
///    b. If active file exists, add dirname of that file.
///    c. If workspace is opened, add rootdirs of that workspace.
///    d. User is also allowed to type in whatever path, instead of choosing from the list.
///
/// 5. Extension dynamically expands entries in chosen template
///    a. If path is defined, evals it to obtain path of the file to create.
///    b. Skip existing file unless invoked in "expand-and-overwrite" mode.
///    c. If body is defined, evals it to obtain body of the file to create.
///    d. If both path and body are defined, create file.
///    e. If hook is defined, call it as hook(path, body).
///

import * as vscode from 'vscode';
import * as util from 'util';
import * as path from 'path';
import * as cp from 'child_process';
import * as ts from 'typescript';
import * as http from 'http';
import * as https from 'https';

let enc = new util.TextEncoder();

//////////////////////////////////////////////////////////////////////
// Command entry points
//////////////////////////////////////////////////////////////////////

let expandTemplate = async (context: vscode.ExtensionContext, opt?: {
	overwrite?: boolean,
	basedir?: string,
	key?: string,
	configs?: string[]
}) => {
	let cfs = (opt?.configs || []).concat(findConfig(context));
	let tps = await loadConfig(context, cfs);

	if (Object.entries(tps).length === 0) {
		let ret = await vscode.window.showInformationMessage("No configuration found. Create one?", "YES", "NO");

		if (ret === "YES") {
			return showQueryToEditConfig(cfs);
		}
		return;
	}

	let editkey = '<Edit Template>';
	let key  = opt?.key || await vscode.window.showQuickPick(Object.keys(tps).concat([editkey]));

	if (key === editkey) {
		return showQueryToEditConfig(cfs);
	}

	if (key) {
		return processTemplate(tps[key], opt);
	}
};

//////////////////////////////////////////////////////////////////////
// Internal functions
//////////////////////////////////////////////////////////////////////

let findConfig = (context: vscode.ExtensionContext): string[] => {
	let myid = "tai.dynamic-template";
	let vscf = vscode.workspace.getConfiguration('dynamicTemplate'); // vscf = Workspace || User
	let cfgs: string[] = [];

	// Try: vscode-prepared storage for this extension (global)
	if (context.globalStoragePath) {
		//dirs.push(context.globalStoragePath)
	}

	// Try: vscode-prepared storage for this extension (per-workspace)
	if (context.storagePath) {
		//dirs.push(context.storagePath)
	}

	// Try: Given files in settings
	for (let cf of vscf.configFiles) {
		cfgs.push(cf);
	}

	// Try: <wsroot>/.vscode/extensions/dynamic-template/template.js
	let wslist = vscode.workspace.workspaceFolders || [];
	for (let ws of wslist) {
		cfgs.push(path.join(ws.uri.fsPath, ".vscode", "extensions", myid, "template.js"));
	}

	// Try: ~tai/.vscode/extensions/dynamic-template/template.js
	if (process.env["HOME"]) {
		cfgs.push(path.join(process.env["HOME"], ".vscode", "extensions", myid, "template.js"));
	}

	// Try: /Users/tai/.vscode/extensions/dynamic-template/template.js
	if (process.env["USERPROFILE"]) {
		cfgs.push(path.join(process.env["USERPROFILE"], ".vscode", "extensions", myid, "template.js"));
	}

	return cfgs;
};

///
/// Load <dir>/extensions/dynamic-template/template.js files.
///
/// Returns a Promise that resolves to merged configuration data, with
/// key as a string for user selection and a value with a list of
/// templates to expand.
///
let loadConfig = async (context: vscode.ExtensionContext, configs: string[] = []) => {
	let results = [];
	for (let cf of configs) {
		let dir = path.dirname(cf);
		let src = vscode.Uri.file(cf);
		let ret = vscode.workspace.fs.readFile(src).then(doc => {
			// NOTE:
			// - Here, I wrap user configuration as CommonJS-like JS module to obtain template.
			// - Decided not to use TypeScript as transpiler may (unlikely, but) generate
			//   incompatible code for my use.
			//let code = ts.transpile(doc.toString());
			let code = doc.toString();

			// Define vars and helpers for use in configuration
			// Some VSCode config vars that may be useful for template processing are defined here.
			// - https://github.com/microsoft/vscode/issues/70769
			// - https://code.visualstudio.com/docs/editor/variables-reference

			// path-related template vars
			var file = vscode.window.activeTextEditor?.document.uri.fsPath;
			var fileDirname = file && path.dirname(file);
			var configDir = dir;
			var HOME = process.env["HOME"] || process.env["USERPROFILE"];

			// time-related template vars
			var NOW  = new Date();
			var YEAR = `${NOW.getFullYear()}`;
			var MON  = (mm => { return mm < 10 ? `0${mm}` : `${mm}`; })(NOW.getMonth() + 1);
			var DATE = (dd => { return dd < 10 ? `0${dd}` : `${dd}`; })(NOW.getDate());
			var HOUR = (hh => { return hh < 10 ? `0${hh}` : `${hh}`; })(NOW.getHours());
			var MIN  = (mm => { return mm < 10 ? `0${mm}` : `${mm}`; })(NOW.getMinutes());
			var YMD  = `${YEAR}${MON}${DATE}`;

			// template helpers
			var vsadd  = (arg: string) => { vscode.workspace.updateWorkspaceFolders(0, 0, { uri: vscode.Uri.file(arg) }); };
			var vsopen = (arg: string) => { vscode.commands.executeCommand('vscode.open', vscode.Uri.file(arg)); };
			var vsexec = (arg: string) => { cp.exec(arg); };
			var vsget  = (arg: string) => {
				return new Promise<string>((resolve, reject) => {
					var body = '';

					// FIXME: Support both HTTP/HTTPS
					https.request(arg, res => {
						res.on('data', (chunk: string) => { body += chunk; });
						res.on('end', () => { resolve(body); });
					}).end();
				});
			};

			// Evaluate and obtain template.
			// Use of vm/vm2 module was tested for clear separation of global context,
			// but didn't work out as they couldn't load 'vscode' module inside each context.
			let wrap = `(() => {
				let mod = { exports: {} };
				((module, exports) => { ${code}; })(mod, mod.exports);
				return mod.exports.getTemplate();
			})()`;
			return eval(wrap);
		}, err => {
			if (err.name.startsWith("EntryNotFound")) {
				return;
			}
			console.error(err);
		});

		results.push(ret);
	}

	return Promise.all(results).then(ret => {
		let config: {[name:string]: any} = {};
		for (let cf of ret) {
			Object.assign(config, cf);
		}
		return config;
	});
};

///
/// Expands selected template(s)
///
let processTemplate = async (templates: any[], opt?: {
	overwrite?: boolean,
	basedir?: string
}) => {
	let basedir = opt?.basedir;
	let writetasks = [];

	for (let tp of templates) {
		let tp_path = tp.path;
		if (typeof(tp.path) === "function") {
			tp_path = tp.path();
		}

		if (! path.isAbsolute(tp_path)) {
			if (! basedir) {
				basedir = await showQueryForAnchorDir();
			}
			if (! basedir) {
				throw(new Error('No anchordir selected for template.'));
			}
			tp_path = path.join(basedir, tp_path);
		}

		let tp_body = tp.body;
		if (typeof(tp.body) === "function") {
			tp_body = tp.body(tp_path);
		}

		// FIXME:
		// - Refactor control flow
		// - Add support for async-returned body
		if (tp_path) {
			let uri = vscode.Uri.file(tp_path);
			let ret = vscode.workspace.fs.stat(uri).then(ok => {
				if (opt?.overwrite) {
					if (tp_body !== undefined) {
						return vscode.workspace.fs.writeFile(uri, enc.encode(tp_body));
					}
				}
			}, ng => {
				if (ng.name.startsWith('EntryNotFound')) {
					if (tp_body !== undefined) {
						return vscode.workspace.fs.writeFile(uri, enc.encode(tp_body));
					}
					return;
				}
				throw(ng);
			}).then(() => {
				if (typeof(tp.hook) === "function") {
					tp.hook(tp_path, tp_body);
				}
			});
			writetasks.push(ret);
		}
	}
	return Promise.all(writetasks);
};

//////////////////////////////////////////////////////////////////////
// UI components
//////////////////////////////////////////////////////////////////////

/// history buffer to track user selection
let anchorHist: string[] = [];

///
/// Show "pick-n-edit" UI to choose base folder to expand template
///
let showQueryForAnchorDir = async () => {
	let dirs: string[] = [];
	
	for (let hist of anchorHist) {
		if (! dirs.includes(hist)) {
			dirs.push(hist);
		}
	}

	let fn = vscode.window.activeTextEditor?.document.fileName;
	if (fn) {
		dirs.push(path.dirname(fn));
	}

	for (let te of vscode.window.visibleTextEditors) {
		let dn = path.dirname(te.document.fileName);
		if (! dirs.includes(dn)) {
			dirs.push(dn);
		}
	}

	let ws_list = vscode.workspace.workspaceFolders || [];
	for (let ws of ws_list) {
		let dn = ws.uri.fsPath;
		if (! dirs.includes(dn)) {
			dirs.push(dn);
		}
	}

	return showQuickPickEdit(dirs, {
		placeholder: 'Enter base folder to expand template(s)'
	}).then(dir => {
		// record recent history
		if (dir) {
			anchorHist = anchorHist.filter(hist => hist !== dir);
			anchorHist.unshift(dir);
			while (anchorHist.length > 10) {
				anchorHist.pop();
			}
		}
		return dir;
	});
};

///
/// Generic entry type for use in QuickEditPick
///
class LabelItem implements vscode.QuickPickItem {
	constructor(public label: string) {}
}

///
/// Generic QuickPick+InputBox
///
let showQuickPickEdit = async (labels: string[], opt = {
	placeholder: ''
}) => {
	let disposables: vscode.Disposable[] = [];
	
	try {
		return await new Promise<string|undefined>((ok, ng) => {
			let input = vscode.window.createQuickPick<LabelItem>();
			input.placeholder = opt.placeholder;
			input.items = labels.map(s => new LabelItem(s));

			let do_update = true;
			disposables.push(
				input.onDidChangeValue(value => {
					do_update = value ? false : true;
				}),
				input.onDidChangeActive(items => {
					const item = items[0];
					if (do_update) {
						input.value = item.label;
					}
				}),
				input.onDidAccept(() => {
					const item = input.activeItems[0];
					ok(input.value ? input.value : item.label);
					input.hide();
				}),
				input.onDidHide(() =>{
					ok(undefined);
					input.dispose();
				})
			);
			input.show();
		});
	}
	finally {
		disposables.forEach(d => d.dispose());
	}
};

///
/// Shows QuickPickEdit UI to choose template configuration to edit.
///
let showQueryToEditConfig = async (configs: string[]) => {
	let cf = await vscode.window.showQuickPick(configs);

	if (cf === undefined) {
		return;
	}

	let uri = vscode.Uri.file(cf);
	return vscode.workspace.fs.stat(uri).then(ok => {
		return vscode.commands.executeCommand('vscode.open', uri);
	}, ng => {
		return createAndOpenConfig(uri);
	});
};

///
/// Shows dialog to confirm creating new template config.
///
let createAndOpenConfig = async (cfuri: vscode.Uri) => {
	// FIXME: If possible, try to load external sample bundled in extension package.
	let sample = `//
// This is a sample template configuration to use as a starter.
// It defines 2 templates that can be selected in VSCode UI.
//
exports.getTemplate = () => {
	return {
		//
		// Sample template definition that consists of 2 files
		// 
		"My Simple Template": [{
			path: "sample-filename.txt",
			body: "sample-content"
		}, {
			path: "another-filename.txt",
			body: "another-content"
		}],

		//
		// Sample template definition that consists of 1 file, with
		// dynamic variable "YMD" expanded to string like '20200101'
		// in filename and content.
		//
		// List of available variables are described in following URL:
		// https://github.com/tai/dynamic-template/doc/template-variables.md
		//
		// It also defines 'hook' function to open created file.
		//
		"My Dynamic Template": [{
			path: \`\${YMD}.md\`,
			body: \`# \${YMD}\`,
			hook: (path, body) => { vsopen(path); }
		}],

	};
};`;
	vscode.workspace.fs.writeFile(cfuri, enc.encode(sample)).then(() => {
		vscode.commands.executeCommand('vscode.open', cfuri);
	});
};

//////////////////////////////////////////////////////////////////////
// exported functions
//////////////////////////////////////////////////////////////////////

///
/// activate this extension
///
export function activate(context: vscode.ExtensionContext) {
	//
	// register command handlers (command ID must match with package.json)
	//
	let disposables = [
		vscode.commands.registerCommand('extension.expandTemplate', (uri?: vscode.Uri, opt: {
			overwrite?: boolean,
			key?: string,
			configs?: string[]
		} = {
			overwrite: true
		}) => {
			expandTemplate(context, { basedir: uri?.fsPath, overwrite: opt.overwrite, key: opt.key, configs: opt.configs });
		}),
	];

	disposables.forEach(d => context.subscriptions.push(d));
}

///
/// deactivate this extension
///
export function deactivate() {}
