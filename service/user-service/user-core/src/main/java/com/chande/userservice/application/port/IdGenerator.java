package com.chande.userservice.application.port;

import java.util.UUID;

public interface IdGenerator {

    UUID newId();
}
