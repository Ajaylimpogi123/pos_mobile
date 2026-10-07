<?php

namespace App\Http\Requests\Customers;

/**
 * Field rules shared by customer create and update (update is partial).
 */
final class CustomerRules
{
    /**
     * Digits, spaces and `+ ( ) -` only.
     */
    public const CONTACT_REGEX = '/^[0-9+()\-\s]+$/';

    /**
     * `first_name` is required on create and cannot be null on update; every other
     * field is optional and accepts null to clear it.
     *
     * @return array<string, list<mixed>>
     */
    public static function rules(bool $partial): array
    {
        return [
            'first_name' => [...($partial ? ['sometimes'] : []), 'required', 'string', 'max:60'],
            'last_name' => ['sometimes', 'nullable', 'string', 'max:60'],
            'contact' => ['sometimes', 'nullable', 'string', 'max:30', 'regex:'.self::CONTACT_REGEX],
            'email' => ['sometimes', 'nullable', 'string', 'email', 'max:255'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }
}
