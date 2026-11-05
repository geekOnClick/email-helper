# Spec Delta

## MODIFIED Requirements

### Requirement: SMTP-аутентификация по провайдеру

Система SHALL аутентифицироваться на SMTP-сервере провайдера, используя ту же стратегию учётных данных, что и для IMAP: для Яндекс — логин и пароль приложения (`basic`) на `smtp.yandex.ru:465` (TLS); для Outlook — access token через механизм XOAUTH2 (`oauth2`) на SMTP-сервере Outlook, полученный и обновляемый через то же хранилище OAuth2-токенов, что и IMAP; для Mail.ru Group — логин и пароль приложения (`basic`) на `smtp.mail.ru:465` (TLS).

#### Scenario: Яндекс SMTP basic

- **WHEN** отправляется письмо с Яндекс-аккаунта (стратегия basic)
- **THEN** система аутентифицируется на `smtp.yandex.ru:465` логином и паролем приложения

#### Scenario: Outlook SMTP OAuth2

- **WHEN** отправляется письмо с Outlook-аккаунта (стратегия oauth2)
- **THEN** система аутентифицируется на SMTP-сервере Outlook access token через XOAUTH2, переиспользуя refresh token из хранилища

#### Scenario: Mail.ru SMTP basic

- **WHEN** отправляется письмо с аккаунта Mail.ru Group (стратегия basic)
- **THEN** система аутентифицируется на `smtp.mail.ru:465` (TLS) логином и паролем приложения

#### Scenario: SMTP-сессия независима от IMAP-сессии

- **WHEN** отправляется письмо при активной IMAP-сессии
- **THEN** система использует отдельное SMTP-соединение и не нарушает активную IMAP-сессию
