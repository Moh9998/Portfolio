<?php
// Replace with your actual receiving email address
$receiving_email_address = 'your-email@example.com';

// Check if form data is submitted
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    
    $name = isset($_POST['name']) ? strip_tags($_POST['name']) : '';
    $email = isset($_POST['email']) ? strip_tags($_POST['email']) : '';
    $subject = isset($_POST['subject']) ? strip_tags($_POST['subject']) : '';
    $message = isset($_POST['message']) ? strip_tags($_POST['message']) : '';

    if (empty($name) || empty($email) || empty($subject) || empty($message)) {
        die('Please fill in all required fields.');
    }

    // Email content
    $email_subject = "New Message from: $name";
    $email_body = "Name: $name\n";
    $email_body .= "Email: $email\n\n";
    $email_body .= "Message:\n$message\n";

    $headers = "From: $email\r\n";
    $headers .= "Reply-To: $email\r\n";

    // Send email
    if (mail($receiving_email_address, $email_subject, $email_body, $headers)) {
        echo 'Your message has been sent successfully!';
    } else {
        echo 'Failed to send the message. Please try again later.';
    }
} else {
    die('Invalid request.');
}
?>
