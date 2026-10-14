const api = require('./slackApi.js');
const { SlackSettingsPage } = require('./slackSettingsPage.js');
const { SlackWizardPage } = require('./slackWizardPage.js');
const { SlackWorkspaceCardPage, SlackCredentialsDialogPage, SlackOrgDialogPage } = require('./slackWorkspaceCardPage.js');
const { SlackLinkPages, LinkedAccountsDialogPage } = require('./slackLinkPages.js');
const { SlackDestinationFormPage } = require('./slackDestinationFormPage.js');

class SlackPages {
  constructor(page) {
    this.settings = new SlackSettingsPage(page);
    this.wizard = new SlackWizardPage(page);
    this.card = new SlackWorkspaceCardPage(page);
    this.credentials = new SlackCredentialsDialogPage(page);
    this.orgDialog = new SlackOrgDialogPage(page);
    this.link = new SlackLinkPages(page);
    this.linkedAccounts = new LinkedAccountsDialogPage(page);
    this.destinationForm = new SlackDestinationFormPage(page);
  }
}

module.exports = { SlackPages, api };
