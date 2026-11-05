# Spec Delta

## MODIFIED Requirements

### Requirement: Валидация полей записи аккаунта

Система SHALL валидировать поля записи аккаунта при добавлении/обновлении: `provider` SHALL быть `yandex`, `outlook` или `mail`; `login` SHALL быть непустой строкой; `password` SHALL быть непустой строкой; `authStrategy` SHALL быть `basic` или `oauth2` (по умолчанию `basic`). При невалидном поле система SHALL вернуть читаемую ошибку и SHALL NOT добавлять запись.

#### Scenario: Валидная запись принимается

- **WHEN** добавляется запись с `provider=yandex`, `login=user@yandex.com`, `password=pwd`, `authStrategy=basic`
- **THEN** система принимает запись без ошибок

#### Scenario: Валидная запись Mail.ru принимается

- **WHEN** добавляется запись с `provider=mail`, `login=user@mail.ru`, `password=pwd`, `authStrategy=basic`
- **THEN** система принимает запись без ошибок

#### Scenario: Невалидный provider отклоняется

- **WHEN** добавляется запись с `provider=gmail`
- **THEN** система возвращает ошибку о недопустимом `provider` и не добавляет запись

#### Scenario: Пустой пароль отклоняется

- **WHEN** добавляется запись с пустым `password`
- **THEN** система возвращает ошибку об обязательности пароля и не добавляет запись

#### Scenario: Невалидный authStrategy отклоняется

- **WHEN** добавляется запись с `authStrategy=custom`
- **THEN** система возвращает ошибку о недопустимом `authStrategy` и не добавляет запись
