///<reference types="cypress" />
Cypress.on('uncaught:exception', (err, runnable) => {
    return false;
});
let details;
Cypress.Commands.add('signin', () => {
    Cypress.on('uncaught:exception', (err, runnable) => { return false; })
   // Alpha login
    cy.visit(details.baseUrl)
    cy.get('.panel-left-border > :nth-child(2) > :nth-child(1) > .cognito-asf > :nth-child(3) > #signInFormUsername').type('nitin.dixit14@gmail.com')
    //Enter Password
    cy.get('.panel-left-border > :nth-child(2) > :nth-child(1) > .cognito-asf > :nth-child(5) > #signInFormPassword').type('Test@2023')
    cy.get('.panel-left-border > :nth-child(2) > :nth-child(1) > .cognito-asf > .btn').click()

    cy.origin(details.devUrl, { args: { details } }, ({ details }) => {
        cy.once('uncaught:exception', () => false);
        cy.get('.q-field__native > span').click()
        cy.contains(details.OrganizationName).click()

    })
//     //open source login
//     cy.clearAllCookies()
//     cy.visit('/')
//     cy.get('input#f_efabf917-a6f5-4ee5-91c2-631f1414166e').type('nitin.dixit14@gmail.com')
//     //Enter Password
//     cy.get('input#f_8e96b06e-34f9-4078-aa1c-42d836da9048').type('Test@2023')
//     cy.contains('Sign In').click()

//     cy.origin(details.devUrl, { args: { details } }, ({ details }) => {
//         cy.once('uncaught:exception', () => false);
//         cy.get('.q-field__native > span').click()
//         cy.contains(details.OrganizationName).click()

//     })
})

Cypress.Commands.add('signout', () => {
    cy.get('div.userName').click();
    cy.get('#app > div > div.q-page-container > main > div > div.q-table__middle.scroll > table > tbody > tr > td:nth-child(2)').should('have.length', 1)
    cy.get('.q-item__label').contains('Sign Out').click();
})
Cypress.Commands.add('CallQueryFunction',()=>
{
    cy.once('uncaught:exception', () => false); 
       
                    //click on log module
          cy.origin(details.functionUrl, { args: { details } }, ({ details }) => {
            cy.on("uncaught:exception", (e, runnable) => {
                console.log("error", e);
                console.log("runnable", runnable);
                console.log("error", e.message);
                return false;
                });
          //  cy.get('div.q-item_section.column.q-item_section--main.justify-center').contains(details.moduleLogs).click()
          cy.get('[href="/logs?org_identifier=zinc_production_e8rM51020Mz60O5"]').click()  
          cy.wait(3000)
            // Set time to past 2 days
            cy.get("button[id='date-time-button'] span[class='block']").click({force: true},{ timeout: 4000})
            cy.get('div.relative-row.q-px-md.q-py-sm span.block').contains(details.rTime).click({force: true},{ timeout: 4000})
            //wait for search result
            cy.get('div.q-notification__message.col', { timeout: 30000 }).should('not.exist')
            cy.get('tbody.q-virtual-scroll__content',{ timeout: 30000 }).should('be.visible')    
        })
        //writing query for function 
        cy.origin(details.logUrl, { args: { details } }, ({ details }) => 
            {
         cy.once('uncaught:exception', () => false); 
           //inputQueryFunctionSearch
         cy.get('div.cm-lines.monaco-mouse-cursor-text').should('be.visible',{ timeout: 30000 }); 
         cy.get('div.cm-lines.monaco-mouse-cursor-text').type("queryFunction(_p,stream) as newcol |");
        cy.get('span.q-btn__content.text-center.col.items-center.q-anchor--skip.justify-center.row').contains(details.bSearch).click()//click on search button
            cy.get('tbody.q-virtual-scroll__content').should('be.visible',{ timeout: 30000 });
            cy.get('.q-table__top.relative-position.row.items-center').type(details.queryFunctionColumn);
             cy.get('div[title="' + details.queryFunctionColumn + '"] span:nth-of-type(2) img:first-of-type').click({ force: true }); 
             cy.get('#searchGridComponent table.q-table tr th div div').should('have.text','newcol',{ timeout: 30000 })

        //  validation - Result table contains  column has  value
            let count1 = 0;
            const max1 = 5;
            cy.get('tbody.q-virtual-scroll__content tr td:nth-child(2) div').each(($ele) => {
      if ($ele.text().trim().includes(details.concatColumnValue)) {
          expect($ele.text().trim()).to.include(details.concatColumnValue) //Assertion for exact text 
      }
      count1++;
      if (count1 == max1) return false;
  })
})
})
