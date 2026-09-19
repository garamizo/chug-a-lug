migrate((app) => {
  const settings = app.settings();
  settings.backups.cron = '0 4 * * *'; // UTC in the production container.
  settings.backups.cronMaxKeep = 14;
  app.save(settings);
}, (app) => {
  const settings = app.settings();
  settings.backups.cron = '';
  settings.backups.cronMaxKeep = 0;
  app.save(settings);
});
