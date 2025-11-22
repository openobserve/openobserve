<?php
/**
 * SAML 2.0 IdP configuration for testing.
 */

$config = array(

    // This is a authentication source which handles admin authentication.
    'admin' => array(
        'core:AdminPassword',
    ),

    // Authentication source for testing SAML with OpenObserve
    'example-userpass' => array(
        'exampleauth:UserPass',

        // Test users for SAML authentication
        'user1@example.com:user1pass' => array(
            'uid' => array('1'),
            'email' => array('user1@example.com'),
            'name' => array('User One'),
            'givenName' => array('User'),
            'sn' => array('One'),
            'displayName' => array('User One'),
        ),
        'user2@example.com:user2pass' => array(
            'uid' => array('2'),
            'email' => array('user2@example.com'),
            'name' => array('User Two'),
            'givenName' => array('User'),
            'sn' => array('Two'),
            'displayName' => array('User Two'),
        ),
        'admin@example.com:adminpass' => array(
            'uid' => array('admin'),
            'email' => array('admin@example.com'),
            'name' => array('Admin User'),
            'givenName' => array('Admin'),
            'sn' => array('User'),
            'displayName' => array('Admin User'),
        ),
    ),

);
