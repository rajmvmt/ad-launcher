<?php
$GLOBALS['_ta_rp_key'] = 'f9dc0dbcd96f404c93055b2d2b11367b';
$GLOBALS['_ta_reverse_proxy_id'] = '80a1ds';

require 'bootloader_d00ea617c521f6e43f1e91c998f29321.php';

$options = array();
/*
$options = array(
	'replace' => array(
		'This is the text to find' => 'The new text',
		'This is the text to find 2' => 'The new text 2',
	)
);
*/

$tarp = new TARPLoader($options);

$tarp->excute();
?>