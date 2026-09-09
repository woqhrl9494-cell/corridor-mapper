'use strict';
// Entry point retained for the repository's previous audit command.
const {spawnSync}=require('node:child_process');
const result=spawnSync(process.execPath,['--test','tests/tsri_integration.test.js'],{stdio:'inherit',cwd:__dirname});
process.exitCode=result.status||0;
