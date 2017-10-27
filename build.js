#!/usr/bin/env node

/*!
 * @license MIT
 * Copyright (c) 2017 Bernhard Grünewaldt - codeclou.io
 * https://github.com/cloukit/legal
 */
const shell = require('shelljs');
const chalk = require('chalk');
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const Gaze = require('gaze').Gaze;
const argv = require('yargs').argv
const NGC_BINARY = './node_modules/@cloukit/library-build-chain/node_modules/.bin/ngc';
const ANGULAR_CLI_BINARY = './node_modules/./bin/ng';
const ROLLUP_BINARY = './node_modules/@cloukit/library-build-chain/node_modules/.bin/rollup';
const tsconfigTemplate = require('./build-tsconfig-template.js');
const packageJsonTemplate = require('./build-package-json-template.js');
const currentDir = shell.pwd().stdout;
const relativePath = (_path) => {
  const absolutePath = path.resolve(currentDir, _path);
  return absolutePath;
};

//
// COMPODOC
//
const buildCompodoc = (packageJsonName, packageJsonVersion) => {
  if (shell.test('-d', relativePath('./documentation'))) shell.rm('-rf', relativePath('./documentation/'));
  //
  // COMPODOC
  //
  shell.echo(chalk.blue('>> =============='));
  shell.echo(chalk.blue('>> CREATING COMPODOC'));
  shell.echo(chalk.blue('>> =============='));

  // PATCH CDN URLS
  if (shell.test('-d', relativePath('./documentation'))) shell.rm('-rf', relativePath('./documentation/'));
  shell.cd(relativePath('./'));
  const cdnUrl = 'https://cloukit.github.io/compodoc-theme/theme/1.0.0-beta.10';
  const templateFiles = ['page.hbs', 'partials/component.hbs', 'partials/module.hbs', 'partials/routes.hbs', 'partials/overview.hbs'];
  for (let i = 0; i < templateFiles.length; i++) {
    shell.exec(`sed -i -e 's@src="[^"]*js/@src="${cdnUrl}/dist/js/@g' ./node_modules/compodoc/src/templates/${templateFiles[i]}`);
  }
  shell.exec(`sed -i -e 's@href="[^"]*styles/style.css@href="${cdnUrl}/style.css@g' ./node_modules/compodoc/src/templates/page.hbs`);
  shell.exec(`sed -i -e 's@href="[^"]*images/favicon.ico@href="${cdnUrl}/images/favicon.ico@g' ./node_modules/compodoc/src/templates/page.hbs`);
  shell.exec(`sed -i -e 's@src="[^"]*images/compodoc-vectorise.svg@src="${cdnUrl}/images/compodoc-logo.svg@g' ./node_modules/compodoc/src/templates/partials/menu.hbs`);

  // EXECUTE COMPODOC
  if (!argv.watch) {
    const compodocResult = shell.exec(`./node_modules/compodoc/bin/index-cli.js --tsconfig tsconfig-es5.json --disableCoverage --disablePrivateOrInternalSupport --name "${packageJsonName} v${packageJsonVersion}" src`);
    if (compodocResult.code !== 0) {
      shell.echo(chalk.red("COMPODOC ERROR. STOP!"));
      return;
    }
    if (shell.test('-d', relativePath('./documentation/fonts/'))) shell.rm('-rf', relativePath('./documentation/fonts/'));
    if (shell.test('-d', relativePath('./documentation/images/'))) shell.rm('-rf', relativePath('./documentation/images/'));
    if (shell.test('-d', relativePath('./documentation/styles/'))) shell.rm('-rf', relativePath('./documentation/styles/'));
    if (shell.test('-d', relativePath('./documentation/js/'))) shell.rm('-rf', relativePath('./documentation/js/'));
  }
};


/**
 * Build the package to dist
 * @param languageTarget {string} either 'es5' or 'es2015'
 * @param watch {boolean}
 */
const buildPackage = (languageTarget, watch) => {
  //
  // CLEANUP COPY SRC CONTENTS TO BUILD
  //
  if (!shell.test('-d', relativePath('./build/'))) shell.mkdir(relativePath('./build/'));

  const manifest = JSON.parse(shell.cat(relativePath('./package.json')));


  //
  // BUILD OR WATCH
  //
  shell.echo(chalk.blue('>> =============='));
  shell.echo(chalk.blue(`>> ${watch ? 'WATCH' : 'BUILD'} : ${languageTarget}`));
  shell.echo(chalk.blue('>> =============='));


  //
  // WRITE TSCONFIGS
  //
  const tsConfig = tsconfigTemplate.generate(languageTarget, manifest.moduleId);
  fs.writeFileSync(relativePath(`./tsconfig-${languageTarget}.json`), JSON.stringify(tsConfig, null, 2));

  //
  // BUILD WITH ANGULAR COMPILER
  //
  const buildResult = shell.exec(`${NGC_BINARY} -p ./tsconfig-${languageTarget}.json`);

  if (buildResult.code !== 0) {
    shell.echo(chalk.red("NGC ERROR. STOP!"));
    return;
  } else {
    shell.echo(chalk.green(buildResult.stdout));
  }

  //
  // BUILD FLAT ONE FILE MODULE WITH ROLLUP
  //
  const rollupResult = shell.exec(`${ROLLUP_BINARY} ./build/_${languageTarget}/src/${manifest.moduleId}.js -o ./dist/${manifest.moduleId}.${languageTarget}.js`);
  if (rollupResult.code !== 0) {
    shell.echo(chalk.red("ROLLUP ERROR. STOP!"));
    return;
  }

  // ====================
  // DO ONLY ONCE FROM HERE
  if (languageTarget === 'es5') return;
  // ====================

  //
  // WRITE FINAL LIB package.json
  //
  packageJson = packageJsonTemplate.generate(manifest.moduleId, manifest.version, manifest.description, 'peerDependencies', manifest.peerDependencies, 'dependencies', manifest.dependencies, 'devDependencies', manifest.devDependencies);
  fs.writeFileSync(relativePath('./dist/package.json'), JSON.stringify(packageJson, null, 2));

  //
  // COPY METADATA FILE FOR TREE SHAKING
  //
  shell.cp(`./build/_es2015/src/${manifest.moduleId}.metadata.json`, `./dist/${manifest.moduleId}.metadata.json`);

  //
  // COPY README
  //
  shell.cp(`./README.md`, `./dist/`);

  //
  // FIXME: SINCE WE CANNOT CREATE A TYPE-DEFINITION-BUNDLE FILE (YET) WE NEED TO COPY ALL *.d.ts FILES MANUALLY TO DIST
  //
  shell.echo(chalk.blue('>> =============='));
  shell.echo(chalk.blue(`>> D.TS FILES`));
  shell.echo(chalk.blue('>> =============='));
  fse.copySync(relativePath('./build/_es2015/src'), relativePath('./dist'), {
    filter: file => /^.*[.]ts$/.test(file) || shell.test('-d', file) // *.d.ts files and folders!
  });
  shell.echo(chalk.green('done'));
};


//
// INIT
//
const initialCleanup = () => {
  if (shell.test('-d', relativePath('./dist'))) shell.rm('-rf', relativePath('./dist/'));
  shell.mkdir(relativePath('./dist/'));
};

if (argv.watch) {
  var gaze = new Gaze('./src/**/*');
  gaze.on('all', (event, filepath) => {
    try {
      buildPackage('es5', true);
      buildPackage('es2015', true);
      shell.echo(chalk.green('>> =============='));
      shell.echo(chalk.green('>> DONE'));
      shell.echo(chalk.green('>> =============='));
    } catch (err) {
      console.log(err);
    }
  });
} else {
  if (!argv.demo) {
    initialCleanup();
    buildPackage('es5', false);
    buildPackage('es2015', false);
    if (!argv.demo) {
      const packageJson = JSON.parse(shell.cat(relativePath('./dist/package.json')).stdout);
      buildCompodoc(packageJson.name, packageJson.version);
    }
    shell.echo(chalk.green('>> =============='));
    shell.echo(chalk.green('>> DONE'));
    shell.echo(chalk.green('>> =============='));
  }
}

//
// START OR BUILD DEMO PROJECT
//
if (argv.demo) {
  const injectStorySourceCodeAndCopyCode = () => {
    shell.echo(chalk.blue('>> reading demo story source files'));
    const files = fs.readdirSync(relativePath('./src/demo/stories/'));
    if (files !== undefined && files !== null && files.length > 0) {
      let storySource = '';
      for (let i = 0; i < files.length; i++) {
        const storyName = files[i];
        let fileContent = fs.readFileSync(relativePath('./src/demo/stories/' + storyName));
        fileContent = `${fileContent}`.replace(/`/g, '\\`');
        storySource = storySource + `
         case '${storyName}': { return \`${fileContent}\`; }
         `;
      }
      shell.cp('-r', `./src/*`, `./dist-demo/src/`);
      let storiesIndex = fs.readFileSync(relativePath('./src/demo/story-index.ts'));
      storiesIndex = `${storiesIndex}`.replace(/[/][*]___INJECT_SOURCE___[*][/]/, storySource);
      fs.writeFileSync(relativePath('./dist-demo/src/demo/story-index.ts'), storiesIndex);
    }
  };
  const packageJson = JSON.parse(shell.cat(relativePath('./package.json')).stdout);
  shell.echo(chalk.blue('>> creating dist-demo'));
  if (shell.test('-d', relativePath('./dist-demo'))) {
    if (shell.test('-d', relativePath('./dist-demo/node_modules'))) {
      shell.echo(chalk.blue('>> demo node_modules exists. retaining it.'));
      shell.mv(relativePath('./dist-demo/node_modules'), relativePath('./_dist_demo_node_modules'));
    }
    shell.rm('-rf', relativePath('./dist-demo/'));
  }
  shell.cp('-r', `./node_modules/@cloukit/library-build-chain/demo-template`, `./dist-demo`);
  if (shell.test('-d', relativePath('./_dist_demo_node_modules'))) {
    shell.mv(relativePath('_dist_demo_node_modules'), relativePath('./dist-demo/node_modules'));
  }
  injectStorySourceCodeAndCopyCode();
  shell.cd(relativePath('./dist-demo/'));
  if (argv.install) {
    shell.echo(chalk.blue('>> injecting package.json dependencies into dist-demo/package.json'));
    const distPackageJson = JSON.parse(shell.cat(relativePath('./dist-demo/package.json')).stdout);
    distPackageJson.dependencies = packageJson.dependencies;
    fs.writeFileSync(relativePath('./dist-demo/package.json'), JSON.stringify(distPackageJson, null, 2));
    shell.echo(chalk.blue('>> yarn install (this takes time!)'));
    shell.exec(`yarn config set "strict-ssl" false && yarn`);
  }
  if (argv.run) {
    const wildcard = relativePath('./src/') + '/**/*';
    shell.echo(chalk.blue(`>> watching ${wildcard} for changes`));
    const gaze = new Gaze(wildcard);
    gaze.on('all', (event, filepath) => {
      try {
        shell.echo(chalk.blue(`>> ${filepath} has changed. copying it to ./dist-demo/src/`));
        injectStorySourceCodeAndCopyCode();
      } catch (err) {
        console.log(err);
      }
    });
    shell.echo(chalk.blue('>> starting "ng serve" async'));
    shell.exec(`ng serve`, {async: true});
  } else {
    const baseHref = `/${packageJson.moduleId}/${packageJson.version}/demo/`;
    shell.echo(chalk.blue(`>> ng build for baseHref: ${baseHref}`));
    shell.exec(`ng build --base-href ${baseHref}`);
  }
}
