import('./server.mjs').then(({startServer})=>startServer()).catch(error=>{console.error(error.message);process.exitCode=1;});
