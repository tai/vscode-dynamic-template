# Dynamic Template Expander

This extension allows you to create new file/folder based on template,
using dynamic pathname and content.

## Features

![DEMO:Using Dynamic Template](doc/dynamic-template-demo.gif)

- Template is fully configurable and allows both pathname and content to be generated on-the-fly.
  - This is nice when you want to include date/time.
- In addition to predefined template variables for dynamic expansion, you can also use any JavaScript API (including VSCode API) for dynamic processing.
  - Even remote template is possible if you fetch it over the net.
- Hook handler can be defined and run when template is generated.
  - It's handy to have file opened or folder added to workspace.
- You can define both relatively-pathed and absolutely-pathed template.
  - Absolute-path template saves you a trouble from creating it at wrong place.
  - Relative-path template gives you a flexibility by either letting you to select/edit target folder to expand, or use the folder in File Explorer when invoked from context menu.
- Any number of template configuration files can be registered.
  - You can manage workspace-specific template and your personal template separately.

## Requirements

There is no requirement - just install this extension and off you go.

## Extension Settings

This extension contributes the following settings:

* `dynamicTemplate.configFiles`: Add any external configuration in addition to default configurations loaded from workspace and home directory.

By default, configuration(s) are loaded from following locations:

* \<workspace-root\>/.vscode/extensions/tai.dynamic-template/template.js
* \<home\>/.vscode/extensions/tai.dynamic-template/template.js

For multi-root workspace, each workspace rootdir is scanned for above file.

When no configuration is found, this extension enter an interactive workflow to create one.
This means you can just invoke "Expand Template" command without any configuration, right after installation.

## Template configuration

Althrough interactive setup workflow will create one for you,
here's a simple example of template:

```javascript
exports.getTemplate = () => {
  return {

    // Definition of first template
    // As it is in relative path, you will be asked to selecte
    // which folder to expand this template upon invokation.
    "Sample Template": [{
      path: "hello.txt",
      body: "hello, template"
    }],

    // Definition of another template
    // With backtick quoting, predefined template variables can be used for dynamic expansion.
    "Another Template": [{
      path: `${YEAR}-${MON}-${DATE}.txt`,
      body: `${HOUR}:${MIN}`
    }, {
      path: `${HOME}/notes/${YMD}.md`,
      body: `# ${YMD}`
    }],
  };
};
```

Basically, template configuration (template.js) is expected to define a function ```getTemplate()``` that
returns a dictionary with template definitions.

Here's an another example, with somewhat more advanced features:

```javascript
exports.getTemplate = () => {
  return {

    // Similar to "Sample Template" example above, but in more dynamic way
    "Dynamic Template": [{
      path: () => { return "hello.txt"; },
      body: (path) => { return "hello, template"; },
      hook: (path, body) => { vsopen(path); }
    }]

  };
};
```

As you can see, attribute ```path``` and ```body`` can either be a string or a function.
In case of a function, it is expected to return a string.

Another attribute ```hook``` exists to let you run any additional task when template is expanded.
In above case, it is calling ```vscode``` function to make it open automatically.
In addition to predefined template variables, predefined template functions are useful to created advanced template.

## Predefined template variables and functions

Currently, following template variables are predefined for use:

| Name | Example of expanded result | Description |
| ---- | --------------- | ---- |
| file | /foo/bar.txt    | Full pathname of a current file (file opened in active editor) |
| fileDirname | /foo     | Dirname of above current file |
| configDir | ~/.vscode/extensions/tai.dynamic-template | Dirname of template configuration |
| HOME | ~ | Home directory (either $HOME or %USERPROFILE%) |
| NOW | new Date() | JavaScript date object |
| YEAR | 2020 | Year in 4-digit string |
| MON | 01 | Month in 2-digit string |
| DATE | 10 | Date in 2-digit string |
| HOUR | 10 | Hour in 2-digit string |
| HOUR | 01 | Minute in 2-digit string |
| YMD | 20200110 | Year/Month/Date in 8-digit string |

Also following functions are predefined:

| Usage | Description |
| ---- | ----------- |
| vsopen(filepath) | Opens given path in VSCode |
| vsadd(dirpath) | Adds given path to VSCode File Explorer |
| vsexec(command) | Executes given command in shell |

## Advanced Usage

You might have wondered if you can write JavaScript code yourself,
instead of using predefined variables/functions. Yes, you can.

```javascript
let now = new Date();

exports.getTemplate = () => {
  return {

    "My Template": [{
      path: `plan-${now.getYear()}.md`,
      body: `# Plan for FY${now.getYear()}`,
    }]

  };
};
```

As long as ```getTemplate``` function returns a valid dictionary,
anything is possible for you in template configuration.

## Known Issues

* Error reporting is still weak and does not show when it failed to create template.

## TODO

* Add support for fetching template over network

## Release Notes

### 0.1.2

- Updated docs.
- Switched default and expanding template will not overwrite existing files.
- Added separate command with overwrite mode: expandTemplateAndOverwrite.
